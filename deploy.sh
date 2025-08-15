#!/bin/bash
project=admin
env=${1}
service_version=${2}
service=r53changealert

if [ $# -lt 2 ]; then
  echo "Missing Parameters: deploy.sh environment version"
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

export AWS_REGION=${deploy_region}
npm install &&
npm run build &&
cdk deploy --context project=${project} --context environment=${env} --context service=${service} --context version=${service_version} \
    --require-approval never