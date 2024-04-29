const asyncLib = require('async');
const fsPromises = require('fs').promises;
const pathLib = require('path');

const dotenv = require('dotenv');
const handlebars = require('handlebars');
const { Octokit } = require('@octokit/rest');
const makeBadge = require('badge-maker/lib/make-badge');
const simpleIcons = require('simple-icons');
const fontawesome = require('@fortawesome/fontawesome-svg-core');
const fontAwesomeIcons = require('@fortawesome/free-solid-svg-icons');
const fontAwesomeBrandIcons = require('@fortawesome/free-brands-svg-icons');

const badgeData = require('./data/badges.json');

// Load environment variables
dotenv.config();

const DEFAULT_COLOR = process.env.COLOR || '#000';
const DEFAULT_LABEL_COLOR = process.env.LABEL_COLOR || '#FCFCFC';

async function deleteSvgFilesInFolder(targetFolder) {
    const filesInFolder = await fsPromises.readdir(targetFolder);

    const results = [];

    for (const fileName of filesInFolder) {
        if (fileName.endsWith('.svg')) {
            results.push(fsPromises.unlink(pathLib.join(targetFolder, fileName)));
        }
    }

    await Promise.all(results);
}

function createMarkdownFromTemplate(templateData, markdownTemplate) {
    return handlebars.compile(markdownTemplate)(templateData);
}

async function fetchUserRepositories(octokit) {
    return octokit.paginate(
        octokit.rest.repos.listForAuthenticatedUser,
        {
            visibility: 'all',
            per_page: 100,
        },
    );
}

async function fetchRepositoryTopics(octokit, repoIdentifier) {
    const [owner, repo] = repoIdentifier.split('/');

    return octokit.rest.repos.getAllTopics({
        owner,
        repo,
    });
}

function compileTopicSummary(repositories) {
    const topicCounts = {};

    for (const { data: { names: topicNames } } of repositories) {
        topicNames.push('git'); // Add 'git' topic by default

        for (const topicName of topicNames) {
            topicCounts[topicName] = (topicCounts[topicName] || 0) + 1;
        }
    }

    return topicCounts;
}

async function readOrGenerateCachedData(cacheFile) {
    const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

    try {
        const fileStats = await fsPromises.stat(cacheFile);

        if (Date.now() - fileStats.mtimeMs < WEEK_IN_MS) {
            const cachedContent = await fsPromises.readFile(cacheFile);
            console.log(`Using valid cache data from ${cacheFile}.`);
            return JSON.parse(cachedContent);
        }
    } catch {
        console.log('Cache not found or expired, generating new data.');
    }
}

async function generateRepoTopicSummary(octokit) {
    const cacheFile = 'badges.cache.json';
    const cachedSummary = await readOrGenerateCachedData(cacheFile);

    if (cachedSummary) {
        return cachedSummary;
    }

    const userRepos = await fetchUserRepositories(octokit);
    const repoIdentifiers = userRepos.map((repository) => repository.full_name);

    const repoTopics = await asyncLib.mapLimit(
        repoIdentifiers,
        100,
        async (repoId) => fetchRepositoryTopics(octokit, repoId),
    );

    const topicSummary = compileTopicSummary(repoTopics);
    await fsPromises.writeFile(cacheFile, JSON.stringify(topicSummary));

    return topicSummary;
}

async function searchRepositories(octokit, searchQuery) {
    return octokit.paginate(
        octokit.rest.search.repos,
        {
            q: searchQuery,
            per_page: 100,
        },
    );
}

async function getPinnedRepoBadges(octokit) {
    const cacheFile = 'pinned.cache.json';
    const cachedPinnedRepos = await readOrGenerateCachedData(cacheFile);

    if (cachedPinnedRepos) {
        return cachedPinnedRepos;
    }

    const searchResults = await searchRepositories(octokit, 'user:uselessscat topic:pinned');
    const pinnedFolderPath = pathLib.join('.', 'assets', 'pinned');
    await deleteSvgFilesInFolder(pinnedFolderPath);

    const pinnedRepos = [];

    for (const { name, html_url: htmlUrl } of searchResults) {
        const badgeFilePath = pathLib.join(pinnedFolderPath, `${name}.svg`);
        pinnedRepos.push({
            name,
            url: htmlUrl,
            badge: badgeFilePath,
        });

        const repoBadge = makeBadge({
            label: '',
            message: name,
            color: DEFAULT_LABEL_COLOR,
        });

        await fsPromises.writeFile(badgeFilePath, repoBadge);
    }

    pinnedRepos.sort((a, b) => a.name.localeCompare(b.name));
    await fsPromises.writeFile(cacheFile, JSON.stringify(pinnedRepos));

    return pinnedRepos;
}

function updateBadgeMessages(badgeConfig, repositoryTopics) {
    const missingRepositories = new Set();
    const unusedTopics = new Set(Object.keys(repositoryTopics));

    for (const section of Object.keys(badgeConfig)) {
        const sectionTopics = badgeConfig[section].elements;

        for (const key of Object.keys(sectionTopics)) {
            const topicName = sectionTopics[key].topic;

            if (topicName && topicName in repositoryTopics) {
                sectionTopics[key].message = `${repositoryTopics[topicName]} Repos`;
                unusedTopics.delete(topicName);
            } else {
                missingRepositories.add(topicName);

                if (!sectionTopics[key].message) {
                    sectionTopics[key].message = '0 Repos';
                }
            }
        }
    }

    console.log('No repositories for topics:', [...missingRepositories].sort());
    console.log('Unused topics:', [...unusedTopics].sort());
}

async function generateBadge(badgeConfig, badgePath) {
    let logoData;

    if (badgeConfig.logo) {
        logoData = await getLogoData(badgeConfig.logo, badgeConfig.logoColor);
    }

    const badgeOptions = {
        label: badgeConfig.label,
        message: badgeConfig.message,
        color: badgeConfig.color,
        logo: logoData,
        labelColor: badgeConfig.labelColor,
    };

    const badge = makeBadge(badgeOptions);
    await fsPromises.writeFile(badgePath, badge);

    return badgePath;
}

async function getLogoData(logoKey, logoColor) {
    if (logoKey.startsWith('si') && simpleIcons[logoKey]) {
        const icon = simpleIcons[logoKey];
        const color = logoColor || `#${icon.hex}`;

        const encodedSvg = Buffer.from(
            icon.svg.replace('<svg', `<svg fill="${color}"`),
        ).toString('base64');

        return `data:image/svg+xml;base64,${encodedSvg}`;
    } else if (logoKey.startsWith('fa') && fontAwesomeIcons[logoKey]) {
        const icon = fontAwesomeIcons[logoKey];
        const color = logoColor || DEFAULT_COLOR;

        const iconSvg = fontawesome.icon(icon).html[0];
        const encodedSvg = Buffer.from(
            iconSvg.replace('<svg', `<svg fill="${color}"`),
        ).toString('base64');

        return `data:image/svg+xml;base64,${encodedSvg}`;
    } else if (logoKey.startsWith('fab') && fontAwesomeBrandIcons[logoKey.replace('fab', 'fa')]) {
        const icon = fontAwesomeBrandIcons[logoKey.replace('fab', 'fa')];
        const color = logoColor || DEFAULT_COLOR;

        const iconSvg = fontawesome.icon(icon).html[0];
        const encodedSvg = Buffer.from(
            iconSvg.replace('<svg', `<svg fill="${color}"`),
        ).toString('base64');

        return `data:image/svg+xml;base64,${encodedSvg}`;
    }

    return undefined;
}

async function createBadgesForConfig(badgeConfig) {
    const badgeDirectory = pathLib.join('.', 'assets', 'badges');
    await deleteSvgFilesInFolder(badgeDirectory);

    const badgesContent = {};

    for (const section of Object.keys(badgeConfig)) {
        const sectionElements = badgeConfig[section].elements;
        const sectionBadgePath = pathLib.join(badgeDirectory, `${section}.svg`);

        const sectionBadgeConfig = {
            label: '',
            message: badgeConfig[section].message,
            color: badgeConfig[section].color || DEFAULT_COLOR,
            logo: badgeConfig[section].logo,
        };

        await generateBadge(sectionBadgeConfig, sectionBadgePath);

        badgesContent[section] = {
            label: badgeConfig[section].message,
            badge: sectionBadgePath,
            elements: {},
        };

        // generate elements badges
        for (const elementKey of Object.keys(sectionElements)) {
            const elementConfig = sectionElements[elementKey];
            const elementBadgePath = pathLib.join(badgeDirectory, `${section}_${elementKey}.svg`);

            const elementBadgeConfig = {
                label: elementConfig.label,
                message: elementConfig.message,
                color: elementConfig.color || DEFAULT_COLOR,
                logo: elementConfig.logo,
                logoColor: elementConfig.logoColor,
                labelColor: elementConfig.labelColor || DEFAULT_LABEL_COLOR,
            };

            await generateBadge(elementBadgeConfig, elementBadgePath);

            badgesContent[section].elements[elementKey] = {
                badge: elementBadgePath,
                label: elementConfig.label,
                url: elementConfig.url,
            };
        }
    }

    return badgesContent;
}

async function main() {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const repoTopicsSummary = await generateRepoTopicSummary(octokit);
    console.log(repoTopicsSummary);

    updateBadgeMessages(badgeData, repoTopicsSummary);

    const generatedBadgesContent = await createBadgesForConfig(badgeData);

    const readmeTemplatePath = pathLib.join('.', 'templates', 'readme.md.handlebars');
    const readmeTemplate = (await fsPromises.readFile(readmeTemplatePath)).toString();
    const readmeContent = createMarkdownFromTemplate({
        badges: generatedBadgesContent,
        pinned: await getPinnedRepoBadges(octokit),
    }, readmeTemplate);

    await fsPromises.writeFile('README.md', readmeContent);
}

main();
