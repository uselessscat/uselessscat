const Async = require('async');
const Filesystem = require('fs').promises;
const Path = require('path');

const DotEnv = require('dotenv');
const Handlebars = require('handlebars');
const { Octokit } = require('@octokit/rest');
const makeBadge = require('badge-maker/lib/make-badge');
const icons = require('simple-icons');

const badges = require('./data/badges.json');

// load environment
DotEnv.config();

const COLOR = process.env.COLOR || '#000';
const LABEL_COLOR = process.env.LABEL_COLOR || '#FCFCFC';

async function removeAllSvgFiles(folder) {
    const files = await Filesystem.readdir(folder);

    for (const file of files) {
        if (file.endsWith('.svg')) {
            await Filesystem.unlink(Path.join(folder, file));
        }
    }
}

function generateMarkdown(data, template) {
    const markdown = Handlebars.compile(template)(data);

    return markdown;
}

async function getRepositoryList(octokit) {
    return octokit.paginate(
        octokit.rest.repos.listForAuthenticatedUser,
        {
            visibility: 'all',
            per_page: 100,
        },
    );
}

async function getRepositoryTopics(octokit, path) {
    const [owner, repo] = path.split('/');

    const response = octokit.rest.repos.getAllTopics({
        owner,
        repo,
    });

    return response;
}

function summarizeResults(repositories) {
    const topics = {};

    // iterate over repositories topics
    for (const { data: { names } } of repositories) {
        // add git topic by default ;)
        names.push('git');

        // add topics to the list
        for (const name of names) {
            if (name in topics) {
                topics[name] += 1;
            } else {
                topics[name] = 1;
            }
        }
    }

    return topics;
}

async function getCached(cacheFilePath) {
    const cacheExpiration = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    try {
        const cacheStats = await Filesystem.stat(cacheFilePath);

        if (Date.now() - cacheStats.mtimeMs < cacheExpiration) {
            // Cache is still valid, read from cache file
            const cacheData = await Filesystem.readFile(cacheFilePath);

            // eslint-disable-next-line no-console
            console.log('Cache file exists and is still valid, reading from cache');

            return JSON.parse(cacheData);
        }
    } catch (error) {
        // Cache file does not exist or error occurred, continue with generating results
        // eslint-disable-next-line no-console
        console.log('Cache file does not exist or expired, generating new results');
    }
}

async function generateRepositoryResults(octokit) {
    const cacheFilePath = 'bagdes.cache.json'
    const cachedResults = await getCached(cacheFilePath);

    if (cachedResults) {
        return cachedResults;
    }

    const repositories = await getRepositoryList(octokit);

    // get the full names only
    const paths = repositories.map((repository) => repository.full_name);

    // get all the topic for each repo
    const fullRepositories = await Async.mapLimit(
        paths, // the collection to iterate over
        100, // max async ops at a time, secondary gh rate limit
        async (path) => getRepositoryTopics(octokit, path),
    );

    const summarizedTopics = summarizeResults(fullRepositories);

    // Write results to cache file
    await Filesystem.writeFile(cacheFilePath, JSON.stringify(summarizedTopics));

    return summarizedTopics;
}

async function searchForRepositories(octokit, query) {
    return octokit.paginate(
        octokit.rest.search.repos,
        {
            q: query,
            per_page: 100,
        },
    );
}

async function getPinnedRepositories(octokit) {
    const cacheFilePath = 'pinned.cache.json';
    const cachedResults = await getCached(cacheFilePath);

    if (cachedResults) {
        return cachedResults;
    }

    const results = await searchForRepositories(octokit, 'user:uselessscat topic:pinned');

    // remove all svg files inside the pinned folder
    const pinnedFolder = Path.join('.', 'assets', 'pinned');
    await removeAllSvgFiles(pinnedFolder);

    const pinned = [];

    for (const { name, html_url } of results) {
        const filename = Path.join(pinnedFolder, `${name}.svg`);

        pinned.push({
            name,
            url: html_url,
            badge: filename,
        });

        const badge = makeBadge({
            label: '',
            message: name,
            color: LABEL_COLOR,
        });

        await Filesystem.writeFile(filename, badge);
    }

    pinned.sort((a, b) => a.name.localeCompare(b.name));

    await Filesystem.writeFile(cacheFilePath, JSON.stringify(pinned));

    return pinned;
}

function fillRepositoriesPerTopic(badges, topics) {
    const missingRepos = new Set();
    const unusedTopics = new Set(Object.keys(topics));

    for (const section of Object.keys(badges)) {
        const badgeTopics = badges[section].elements;

        for (const key of Object.keys(badgeTopics)) {
            const { topic } = badgeTopics[key];

            if (topic && topic in topics) {
                badgeTopics[key].message = `${topics[key]} Repos`;

                unusedTopics.delete(topic);
            } else {
                missingRepos.add(topic);
                badgeTopics[key].message = '0 Repos';
            }
        }
    }

    console.log('No repositories using:', [...missingRepos].sort());
    console.log('No badges for:', [...unusedTopics].sort());
}

async function generateBadges(badges) {
    let contents = {};

    // remove all svg files inside the badges folder
    const badgesFolder = Path.join('.', 'assets', 'badges');
    await removeAllSvgFiles(badgesFolder);

    for (const section of Object.keys(badges)) {
        const elements = badges[section].elements;

        // generate section badge
        const sectionFilename = Path.join(badgesFolder, `${section}.svg`);

        contents[section] = {
            label: badges[section].message,
            badge: sectionFilename,
            elements: {},
        };

        const sectionBadge = makeBadge({
            label: '',
            message: badges[section].message,
            color: badges[section].color || COLOR,
        });
        await Filesystem.writeFile(sectionFilename, sectionBadge);

        // generate elements badges
        for (const key of Object.keys(elements)) {
            const filename = Path.join(badgesFolder, `${section}_${key}.svg`);
            const badgeData = {
                color: elements[key].color || COLOR,
                label: elements[key].label,
                labelColor: elements[key].labelColor || LABEL_COLOR,
                message: elements[key].message,
            };

            if (icons[elements[key].logo]) {
                const icon = icons[elements[key].logo];
                const color = elements[key].color || `#${icon.hex}`;
                const logoColor = elements[key].logoColor || `#${icon.hex}`;
                const encodedSvg = Buffer.from(icon.svg.replace('<svg', `<svg fill="${logoColor}"`)).toString('base64');

                Object.assign(badgeData, {
                    color,
                    logo: `data:image/svg+xml;base64,${encodedSvg}`,
                });
            }

            const badge = makeBadge(badgeData);

            await Filesystem.writeFile(filename, badge);

            contents[section].elements[key] = {
                badge: filename,
                label: elements[key].label,
                url: elements[key].url,
            };
        }
    }

    return contents;
}

async function main() {
    // Create the octokit instances to interact with github
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const summarizedTopics = await generateRepositoryResults(octokit);

    // eslint-disable-next-line no-console
    console.log(summarizedTopics);

    fillRepositoriesPerTopic(badges, summarizedTopics);

    const templateContents = {
        badges: await generateBadges(badges),
        pinned: await getPinnedRepositories(octokit),
    }

    // load the template and write data
    const template = (await Filesystem.readFile(Path.join('.', 'templates', 'readme.md.handlebars'))).toString();
    const markdown = generateMarkdown(templateContents, template);

    await Filesystem.writeFile('readme.md', markdown);
}

main();
