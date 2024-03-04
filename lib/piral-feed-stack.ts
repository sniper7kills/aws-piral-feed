import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class PiralFeedStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * Imported Variables and resources
     */
    const domain = new cdk.CfnParameter(this, "Domain", {
      type: "String",
      description: "The domain name hosting the Feed",
      default: "runbook.solutions",
    }).valueAsString;
    const hostedZoneID = new cdk.CfnParameter(this, "HostedZoneID", {
      type: "String",
      description: "The Route53 Hosted Zone ID for the Domain",
    }).valueAsString;
    const subdomain = new cdk.CfnParameter(this, "Subdomain", {
      type: "String",
      description: "The Subdomain for the Feed and CDN (subdomain).(domain) and (subdomain)-cdn.(domain)",
      default: "piral"
    }).valueAsString;

    const public_hosted_zone =
      cdk.aws_route53.HostedZone.fromHostedZoneAttributes(
        this,
        "PublicHostedZone",
        {
          hostedZoneId: hostedZoneID,
          zoneName: domain,
        }
      );

    const cloudfront_oai = new cdk.aws_cloudfront.OriginAccessIdentity(this, "cloudfront-OAI", {
      comment: `OAI for Piral Pilet Files`,
    });

    /**
     * Dynamo DB to hold pilet meta data
     */
    const pilets = new cdk.aws_dynamodb.Table(this, 'Pilets', {
      partitionKey: { name: 'id', type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    pilets.addGlobalSecondaryIndex({
      indexName: 'name-index',
      partitionKey: { name: 'name', type: cdk.aws_dynamodb.AttributeType.STRING },
    });
    pilets.addGlobalSecondaryIndex({
      indexName: 'version-index',
      partitionKey: { name: 'version', type: cdk.aws_dynamodb.AttributeType.STRING },
    });
    pilets.addGlobalSecondaryIndex({
      indexName: 'latest-index',
      partitionKey: { name: 'latest', type: cdk.aws_dynamodb.AttributeType.NUMBER },
    })

    /**
     * Lambda Processing of Uploads
     */
    const upload_processing = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'UploadProcessing', {
      entry: 'lambda/upload_processing.ts',
      handler: 'handler',
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: pilets.tableName,
        CDN_URL: 'https://' + subdomain + "-cdn." + domain,
      },
      timeout: cdk.Duration.seconds(30),
    });
    pilets.grantReadWriteData(upload_processing);

    /**
     * S3 bucket for storing Pilets
     */
    const bucket = new cdk.aws_s3.Bucket(this, 'PiralBucket', {
      publicReadAccess: false,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      // Delete the Following after testing
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [bucket.arnForObjects("*")],
        principals: [
          new cdk.aws_iam.CanonicalUserPrincipal(
            cloudfront_oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );
    bucket.grantReadWrite(upload_processing);
    bucket.addEventNotification(cdk.aws_s3.EventType.OBJECT_CREATED, new cdk.aws_s3_notifications.LambdaDestination(upload_processing), {
      prefix: 'upload/'
    });
    const executeRole = new cdk.aws_iam.Role(this, "role", {
      assumedBy: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      path: "/service-role/"
    });
    bucket.grantReadWrite(executeRole);


    const api = new cdk.aws_apigateway.RestApi(this, 'PiralFeedApi', {
      restApiName: 'Piral Feed API',
      description: 'This service serves as a pilet.io feed.',
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST'],
        allowHeaders: ['*'],
      },
      defaultMethodOptions: {
        authorizationType: cdk.aws_apigateway.AuthorizationType.NONE,
      },
    });

    /**
     * Publishing Pillets (Service Facing)
     * 
     * REF: https://docs.piral.io/reference/specifications/feed-api-specification#publishing-pilets-(service-facing)
     */
    const s3IntegrationPut = new cdk.aws_apigateway.AwsIntegration({
      service: 's3',
      integrationHttpMethod: 'PUT',
      options: {
        credentialsRole: executeRole,
        requestParameters: {
          'integration.request.path.key' : 'context.requestId',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
          },
        ],
      },
      path: `${bucket.bucketName}/upload/{key}`, // Use $context.requestId as part of the filename
    });
    api.root.addMethod('POST', s3IntegrationPut, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Content-Type': true,
            'method.response.header.Content-Length': true,
          },
        },
      ],
    });

    /**
     * Feed Endpoint
     */
    const feed_function = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'FeedFunction', {
      entry: 'lambda/feed.ts',
      handler: 'handler',
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: pilets.tableName,
      },
      timeout: cdk.Duration.seconds(30),
    });
    pilets.grantReadData(feed_function);
    const lambdaIntegration = new cdk.aws_apigateway.LambdaIntegration(feed_function);
    api.root.addMethod('GET', lambdaIntegration);

    /**
     * API Domain + Cert
     */
    const api_cert = new cdk.aws_certificatemanager.Certificate(this, "PiletFeedCertificate", {
      domainName: subdomain + '.' + domain,
      validation:
        cdk.aws_certificatemanager.CertificateValidation.fromDns(
          public_hosted_zone
        ),
    });
    api.addDomainName('PiletFeedDomain', {
      domainName: subdomain + '.' + domain,
      certificate: api_cert,
      endpointType: cdk.aws_apigateway.EndpointType.EDGE,
      securityPolicy: cdk.aws_apigateway.SecurityPolicy.TLS_1_2,
    });
    new cdk.aws_route53.ARecord(this, "PiletFeedARecord", {
      zone: public_hosted_zone,
      recordName: subdomain + '.' + domain,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.ApiGateway(api)
      ),
    });


    /**
     * Cloudfront Distribution
     */
    // CDN Cert
    const cdn_certificate = new cdk.aws_certificatemanager.Certificate(this, "PiletCDNCertificate", {
      domainName: subdomain + "-cdn." + domain,
      validation:
        cdk.aws_certificatemanager.CertificateValidation.fromDns(
          public_hosted_zone
        ),
    });
    // CDN
    const cdn_distribution = new cdk.aws_cloudfront.Distribution( this, "PiletCDN", {
      certificate: cdn_certificate,
      defaultRootObject: "index.html",
      domainNames: [subdomain + "-cdn." + domain],
      minimumProtocolVersion:
        cdk.aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: new cdk.aws_cloudfront_origins.S3Origin(
          bucket,
          {
            originAccessIdentity: cloudfront_oai,
          }
        ),
        compress: true,
        allowedMethods:
          cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy:
          cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: new cdk.aws_cloudfront.ResponseHeadersPolicy(this, "CdnResponseHeadersPolicy", {
          responseHeadersPolicyName: "CdnResponseHeadersPolicy",
          corsBehavior: {
            accessControlAllowCredentials: false,
            accessControlAllowHeaders: ["*"],
            accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
            accessControlAllowOrigins: ["*"],
            originOverride: false,
          },
        }),
      },
    });
    // CDN DNS Record
    new cdk.aws_route53.ARecord(this, "PiletCDNARecord", {
      zone: public_hosted_zone,
      recordName: subdomain + "-cdn." + domain,
      target: cdk.aws_route53.RecordTarget.fromAlias(
        new cdk.aws_route53_targets.CloudFrontTarget(
          cdn_distribution        )
      )
    });


    /**
     * Outputs
     */
    new cdk.CfnOutput(this, "PiletBucketOutput", {
      value: bucket.bucketName,
      description: "The S3 Bucket for Pilets",
    });
    new cdk.CfnOutput(this, "PiletCDNOutput", {
      value: cdn_distribution.domainName,
      description: "The CDN for Pilets",
    });
    new cdk.CfnOutput(this, "PiletFeedOutput", {
      value: api.url,
      description: "The Feed for Pilets",
    });

  }
}
