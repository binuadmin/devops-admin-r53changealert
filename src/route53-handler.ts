// src/route53-handler.ts
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const snsClient = new SNSClient({ region: 'us-east-1' });

export const handler = async (event: any) => {
    const environment = process.env.ENVIRONMENT_NAME || 'Unknown';
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
        TopicArn: process.env.GENERAL_NOTIFICATION_TOPIC,
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
