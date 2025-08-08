#!/bin/bash
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

export STACK_SET_NAME="${project}-${env}-r53changealert"
wait_for_op () {
    if [ "${1}" != "" ]; then # Otherwise it was a create-stack-set operation
        status="RUNNING"
        while [ "${status}" == "RUNNING"  ]; do
            sleep 5
            status=$(aws cloudformation describe-stack-set-operation \
                --stack-set-name ${STACK_SET_NAME} --operation-id ${1} \
                | jq -r '.StackSetOperation.Status')
        done
        if [ "${status}" != "SUCCEEDED" ]; then
            exit 1
        fi
    fi
}

export AWS_REGION=eu-west-1
aws cloudformation describe-stack-set --stack-set-name ${STACK_SET_NAME} > /dev/null 2>&1
if [ $? -ne 0 ]; then
    command=create-stack-set
else
    command=update-stack-set
    operation_preferences="--operation-preferences FailureToleranceCount=5,MaxConcurrentCount=10,RegionConcurrencyType=PARALLEL"
fi

echo "Creating/Updating stack set \"${STACK_SET_NAME}\" in ${AWS_REGION}"
wait_for_op $( \
    aws cloudformation ${command} \
        --stack-set-name ${STACK_SET_NAME} \
        --template-body file://template.yml \
        --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
        --permission-model SERVICE_MANAGED \
        --auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false \
        --parameters \
            ParameterKey=Project,ParameterValue=${project,,} \
            ParameterKey=Environment,ParameterValue=${env,,} \
        --tags \
            Key=project,Value=${project,,} \
            Key=environment,Value=${env,,} \
            Key=service,Value=r53changealert \
            Key=version,Value=${service_version} \
        ${operation_preferences} \
        | jq -r '.OperationId')

echo "Creating stack instances"
wait_for_op $( \
    aws cloudformation create-stack-instances \
        --stack-set-name ${STACK_SET_NAME} \
        --deployment-targets OrganizationalUnitIds=$(yq e ".targetOUs" ../vars/${env,,}.yml) \
        --regions $(yq e ".targetRegions" ../vars/${env,,}.yml) \
        ${operation_preferences} \
        | jq -r '.OperationId')