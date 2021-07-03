const FileSystem = require('fs').promises;
const DotEnv = require('dotenv');
const Async = require('async');
const Handlebars = require('handlebars');
const { Octokit } = require('octokit');

const bagdes = require('./data/bagdes.json');

async function loadFile(filePath) {
    const content = await FileSystem.readFile(filePath);

    return content.toString();
}

async function writeFile(filePath, data) {
    return FileSystem.writeFile(filePath, data);
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
        // preview feature
        mediaType: {
            previews: [
                'mercy',
            ],
        },
    });

    return response;
}

function summarizeResults(repositories) {
    const topics = {};

    // iterate over repositories topics
    repositories.forEach(({ data: { names } }) => {
        // add git topic by default ;)
        names.push('git');

        // add topics to the list
        names.forEach((name) => {
            if (name in topics) {
                topics[name] += 1;
            } else {
                topics[name] = 1;
            }
        });
    });

    return topics;
}

function fillRepositoriesPerTopic(original, data) {
    original.sections.forEach((section) => {
        const topics = section.elements;

        Object.keys(topics).forEach((key) => {
            const { topic } = topics[key];

            if (topic && topic in data) {
                topics[key].message = `${data[key]}%20Repos`;
            }
        });
    });

    return original;
}

async function main() {
    // load environment
    DotEnv.config();

    // Create the octokit instances to interact with github
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const repositories = await getRepositoryList(octokit);

    // get the full names only
    const paths = repositories.map((repository) => repository.full_name);

    // get all the topic for each repo
    const fullRepositories = await Async.mapLimit(
        paths, // the collection to iterate over
        100, // max async ops at a time
        async (path) => getRepositoryTopics(octokit, path),
    );

    const summarizedTopics = summarizeResults(fullRepositories);

    // eslint-disable-next-line no-console
    console.log(summarizedTopics);

    const summarized = fillRepositoriesPerTopic(bagdes, summarizedTopics);

    // load the template and write data
    const template = await loadFile('./templates/readme.md.handlebars');
    const markdown = generateMarkdown(summarized, template);

    await writeFile('readme.md', markdown);
}

main();
