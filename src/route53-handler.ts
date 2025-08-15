// src/route53-handler.ts
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const topicArn = process.env.GENERAL_NOTIFICATION_TOPIC;
const environment = process.env.environment || 'Unknown';

// Extract region directly from the topic ARN
const snsRegion = topicArn?.match(/^arn:aws:sns:([a-z0-9-]+):/)?.[1] || 'eu-west-1';
const snsClient = new SNSClient({ region: snsRegion });

export const handler = async (event: any) => {
    console.log(`Received Route 53 event from ${environment} account:`, JSON.stringify(event, null, 2));
    
    const message = {
        eventTime: event.time,
        eventName: event.detail?.eventName || 'Unknown',
        eventSource: event.detail?.eventSource || 'Unknown',
        sourceIPAddress: event.detail?.sourceIPAddress || 'Unknown',
        userIdentity: event.detail?.userIdentity || {},
        requestParameters: event.detail?.requestParameters || {},
        responseElements: event.detail?.responseElements || {},
        accountId: event.account || 'Unknown'
    };
    
    const params = {
        TopicArn: topicArn,
        Subject: `${environment} Route 53 Change Alert: ${message.eventName}`,
        Message: JSON.stringify(message, null, 2)
    };
    
    try {
        const command = new PublishCommand(params);
        const result = await snsClient.send(command);
        console.log('Successfully published to SNS:', result.MessageId);
        return { statusCode: 200, body: 'Success' };
    } catch (error) {
        console.error('Failed to publish to SNS:', error);
        throw error;
    }
};
