# Piral AWS Serverless Feed

The following contains an AWS Serverless implementation of the [Piral Feed Service](https://docs.piral.io/reference/specifications/feed-api-specification)

It serves as a Proof-Of-Concent, and only implments the most basic of feed functions.

**Credits**
The `lambda/helpers` directory is basically a direct rip from `https://github.com/smapiot/sample-pilet-service` with minor changes to the `pilet.ts` class for.


## NOTES:
### Pilet Processing
Due to API Gateway limits of processing a 6MB post request, the actual processing of the Pilet's is done after the file is upload.

I.E. `npx pilet publish --url https://...` will **NOT** get the expected return results, and will always return 200.

### Authentication
There is currently **NO** authentication in place.
It is **HIGHLY** recomended that you implement an API authorizer for this route.


-----------------------------------------------

# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
