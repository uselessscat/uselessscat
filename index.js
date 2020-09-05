require('dotenv').config()

const { Octokit } = require('@octokit/core');

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function getRepositories() {
    const response = await octokit.request('GET /user/repos', {
        type: 'all',
        mediaType: {
            previews: ['mercy'], // get topics
        },
    });

    octokit.request('GET /user/repos', {
        type: 'all',
        visibility: 'all',

    });

    return response;
}

function summarizeResults(response) {
    const results = {
        visibility: {
            public: 0,
            private: 0
        },
        
    };

    response.data.forEach(element => {

    });

    return results;
}

async function main() {
    // TODO: iterate over pages
    const response = getRepositories()

    const summarized = summarizeResults(await response)
    console.log(summarized)
}

main()