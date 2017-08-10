#!/usr/bin/env node
'use strict';

const readline = require('readline');
const fs = require('fs');
const ConfigStore = require('configstore');
const {prompt} = require('inquirer');
const figures = require('figures');
const pokemon = require('pokemon');
const chalk = require('chalk');
const meow = require('meow');
const pify = require('pify');
const ora = require('ora');
const opn = require('opn');
const got = require('got');
const databases = require('./databases');
const pkg = require('./package');

const {writeFile} = pify(fs);

meow(`
	Usage
	  $ pronto [input]
`);

const config = new ConfigStore(pkg.name);

const waitForEnter = () => {
	return new Promise(resolve => {
		const handleKeyPress = (ch, key) => {
			if (key.name === 'return') {
				process.stdin.removeListener('keypress', handleKeyPress);
				resolve();
			}
		};

		process.stdin.on('keypress', handleKeyPress);
	});
};

const getDbName = value => databases.find(db => db.value === value).name;

const log = (message, color = 'blue') => console.log(`${chalk[color](figures.pointer)} ${message}`);

const askForToken = async () => {
	const {answer} = await prompt([{
		message: 'Enter Compose token:',
		name: 'answer'
	}]);

	return answer;
};

const askForDatabase = async () => {
	const {answer} = await prompt([{
		type: 'list',
		message: 'Select a database to deploy:',
		name: 'answer',
		choices: databases
	}]);

	return answer;
};

const getAccountId = async composeToken => {
	const res = await got('https://api.compose.io/2016-07/user', {
		headers: {
			authorization: `Bearer ${composeToken}`
		},
		json: true
	});

	return res.body.id;
};

const deploy = async (composeToken, type, name) => {
	const accountId = await getAccountId(composeToken);

	const res = await got.post('https://api.compose.io/2016-07/deployments', {
		headers: {
			authorization: `Bearer ${composeToken}`
		},
		json: true,
		body: {
			deployment: {
				account_id: accountId, // eslint-disable-line camelcase
				datacenter: 'aws:us-east-1',
				name,
				type
			}
		}
	});

	return res.body;
};

const main = async () => {
	let composeToken = config.get('composeToken');
	if (!composeToken) {
		log('To use Pronto, you need to enter your Compose access token', 'grey');
		log('Press Enter to open a browser and create a token', 'grey');
		await waitForEnter();

		opn('https://app.compose.io/oauth/api_tokens');

		composeToken = await askForToken();
		config.set('composeToken', composeToken);
	}

	const type = await askForDatabase();
	const name = getDbName(type);
	const deploymentName = `${pokemon.random().toLowerCase()}-${type}`;

	const spinner = ora(`Deploying ${name}`).start();

	const db = await deploy(composeToken, type, deploymentName);
	const certPath = `${deploymentName}.crt`;

	spinner.succeed('Deployed');

	await writeFile(certPath, Buffer.from(db.ca_certificate_base64, 'base64'));

	console.log([
		`${chalk.green(figures.tick)} Connection URL copied to clipboard`,
		'',
		`${chalk.blue('ℹ')} Connect via CLI:`,
		`  ${db.connection_strings.cli[0]}`,
		'',
		`${chalk.blue('ℹ')} Connect directly:`,
		`  ${db.connection_strings.direct[0]}`,
		'',
		`${chalk.blue('ℹ')} Certificate saved at ${certPath} in the current directory`,
		''
	].join('\n'));
};

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

process.stdin.on('keypress', (ch, key) => {
	if (key.name === 'esc' || (key.name === 'ctrl' && key.ctrl)) {
		process.exit();
	}
});

main()
	.then(() => {
		process.exit();
	})
	.catch(err => {
		console.error(err.stack);
		process.exit(1);
	});
