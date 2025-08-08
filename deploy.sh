#!/bin/bash
project=admin
env=${1}
service_version=${2}
stack=${3:-"--all"}

if [ $# -lt 2 ]; then
  echo "Missing Parameters: deploy.sh environment version [stack]"
  exit 1
elif [ ! -f vars/${env,,}.yml ]; then
    echo "No corresponding environment file found for '${env,,}' environment"
    exit 1
fi

deploy_account=$(yq e ".account" vars/${env,,}.yml)
deploy_region=$(yq e ".region" vars/${env,,}.yml)
current_account=$(aws sts get-caller-identity | jq -r '.Account')
if [ "${deploy_account}" != "${current_account}" ]; then
    echo "Incorrect credentials for deploying '${env,,}' environment"
    exit 1
fi

if [ "${stack}" != "--all" ]; then
  stack="${project}-${env}-${stack}"
fi

export AWS_REGION=${deploy_region}
npm install &&
npm run build &&
lambdaMonitorVersion=$(aws lambda --region ${deploy_region} list-layer-versions --layer-name UTILITIES-PROD-LambdaMonitor | jq -r '.LayerVersions[].Version') &&
cdk deploy --context project=${project} --context environment=${env} --context service=r53changealert --context version=${service_version} \
    --context lambdaMonitorVersion=${lambdaMonitorVersion} \
    --require-approval never ${stack}
