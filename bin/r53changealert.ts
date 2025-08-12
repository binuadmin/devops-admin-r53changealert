#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs'
import * as yaml from 'yaml';
import { R53ChangeAlertStack } from '../lib/r53changealert-stack';

const app = new cdk.App();
const project = app.node.tryGetContext('project');
const environment = app.node.tryGetContext('environment');
const service = app.node.tryGetContext('service');
const version = app.node.tryGetContext('version');
const vars = yaml.parse(fs.readFileSync(`vars/${environment}.yml`).toString());
const env = {
    account: vars.account,
    region: vars.region
}

new R53ChangeAlertStack(app, `${project}-${environment}-r53changealert`.toUpperCase(), {
    env, project, environment, service, version
});
