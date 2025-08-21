#!/bin/bash
owner=devops
project=admin
env=${1}; shift
service_version=${1}; shift

if [ ! -f ../vars/${env,,}.yml ]; then
    echo "No corresponding environment file found for '${env,,}' environment"
    exit 1
fi

deploy_account=872442554780 # dfree-master for organization stacksets
current_account=$(aws sts get-caller-identity | jq -r '.Account')
if [ "${deploy_account}" != "${current_account}" ]; then
    echo "Incorrect credentials for deploying '${env,,}' environment"
    exit 1
fi

export STACK_NAME="${project}-${env}-r53changealert"
export AWS_REGION=us-east-1
export env=prod

echo "Creating/Updating stack \"${STACK_NAME}\" in ${AWS_REGION}"

extra_vars="region=${AWS_REGION} project=${project} env=${env} service_version=${service_version} source_repo_url=${CODEBUILD_SOURCE_REPO_URL}"
ansible-playbook deploy.yml -e "${extra_vars}" "$@"