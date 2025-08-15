import { Stack, StackProps, Tags, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, SourceMapMode } from 'aws-cdk-lib/aws-lambda-nodejs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

interface R53ChangeAlertStackProps extends StackProps {
  project: string;
  environment: string;
  service: string;
  version: string;
  generalNotificationTopic: string;
}

export class R53ChangeAlertStack extends Stack {
  constructor(scope: Construct, id: string, props: R53ChangeAlertStackProps) {
    super(scope, id, props);

    const project = props.project.toLowerCase();
    const ENVIRONMENT = props.environment.toUpperCase();
    const environment = props.environment.toLowerCase();

  // Use SNS topic ARN directly from props (no replacement needed)
  const generalNotificationTopic = props.generalNotificationTopic;
  // Extract region from SNS topic ARN
  const snsRegionMatch = generalNotificationTopic.match(/^arn:aws:sns:([a-z0-9-]+):/);
  if (!snsRegionMatch) {
    throw new Error(`Could not extract region from SNS topic ARN: ${generalNotificationTopic}`);
  }
  const snsRegion = snsRegionMatch[1];

    // Lambda function using NodejsFunction with entry (same as lambdas project)
    const forwarderFunction = new NodejsFunction(this, 'Route53EventForwarder', {
      functionName: `${project}-${environment}-r53-event-forwarder`,
      runtime: Runtime.NODEJS_22_X,
      entry: 'src/route53-handler.js',
      timeout: Duration.seconds(60),
      description: 'Forward Route 53 changes to SNS topic for alerting',
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 128,
      bundling: {
        sourceMap: true,
        sourceMapMode: SourceMapMode.INLINE
      },
      initialPolicy: [
        new PolicyStatement({
          actions: ['sns:Publish'],
          resources: [generalNotificationTopic]
        })
      ],
      environment: {
        project,
        environment,
        GENERAL_NOTIFICATION_TOPIC: generalNotificationTopic,
        SNS_REGION: snsRegion
      }
    });

    // EventBridge rule for Route 53 changes
    const eventRule = new Rule(this, 'Route53ChangeRule', {
      ruleName: `${project}-${environment}-r53-changes`,
      description: `Detect Route 53 changes in ${ENVIRONMENT} account`,
      eventPattern: {
        source: ['aws.route53'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['route53.amazonaws.com'],
          eventName: [
            'ChangeResourceRecordSets',
            'CreateHostedZone',
            'DeleteHostedZone',
            'UpdateHostedZoneComment',
          ]
        }
      }
    });

    // Add Lambda as target
    eventRule.addTarget(new LambdaFunction(forwarderFunction));

    // Add tags
    Tags.of(this).add('project', project);
    Tags.of(this).add('environment', environment);
    Tags.of(this).add('service', props.service);
    Tags.of(this).add('version', props.version);
  }
}
