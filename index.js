const FileSystem = require('fs').promises;
const DotEnv = require('dotenv')
const Async = require('async');
const Handlebars = require("handlebars");
const { Octokit } = require('@octokit/core');

const bagdes = require('./data/bagdes.json');

async function getRepository(octokit, path) {
    [owner, repo] = path.split('/');

    const response = octokit.request('GET /repos/{owner}/{repo}/topics', {
        owner,
        repo,
        // preview feature
        mediaType: {
            previews: [
                'mercy'
            ]
        }
    });

    return response;
}

async function getRepositories(octokit) {
    const response = await octokit.request('GET /user/repos', {
        type: 'all',
        per_page: '100'
    });

    const paths = response.data.map(repository => repository.full_name);
    const repositories = Async.mapLimit(paths, 100, async path => getRepository(octokit, path));

    return repositories;
}

function summarizeResults(response) {
    const summarizations = response.reduce(
        (previous, { data: { names: names } }) => {
            names.push('git')

            names.forEach(el => {
                if (el in previous) {
                    previous[el] += 1;
                } else {
                    previous[el] = 1;
                }
            });

            return previous;
        }, {});

    console.log(summarizations);
    return summarizations;
}

function fillRepositoryCount(original, data) {
    original.sections.forEach(section => {
        const topics = section.elements;

        Object.keys(topics).forEach(key => {
            const topic = topics[key].topic;

            if (topic && topic in data) {
                topics[key].message = `${data[key]}%20Repos`;
            }
        })
    });

    return original;
}

async function loadFile(filePath) {
    const content = await FileSystem.readFile(filePath);

    return content.toString();
}

async function writeFile(filePath, data) {
    return FileSystem.writeFile(filePath, data)
}

function generateMarkdown(data, template) {
    const markdown = Handlebars.compile(template)(data);

    return markdown;
}

async function main() {
    // load environment
    DotEnv.config();

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // TODO: iterate over pages
    const response = getRepositories(octokit);
    const template = loadFile('./templates/readme.md.handlebars')

    const summarized = fillRepositoryCount(bagdes, summarizeResults(await response));
    const markdown = generateMarkdown(summarized, await template);

    await writeFile('readme.md', markdown);
}

main()