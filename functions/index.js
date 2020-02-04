/* Cloud function to send an email to a new member to welcome them, provide
 * introductory information and most importantly, provide a verification key so
 * they can join the society Discord server.
 *
 * This function requires the following Firebase config values to be set:
 * sendgrid.api_key     API key to access Sendgrid's email service
 * sendgrid.template_id Unique ID for the dynamic template to send the email through
 * sendgrid.from_email  Email that the user should reply to
 * sendgrid.from_name   The name of the sender (i.e. us)
 * For more information, see here https://firebase.google.com/docs/functions/config-env
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const sgClient = require('@sendgrid/client');
const uuidv4 = require('uuid/v4');

// Closest region to Sydney supporting cloud functions
const default_region = 'asia-northeast1'; // Tokyo
const default_collection = 'members-test';
admin.initializeApp(functions.config().firebase);

const db = admin.firestore();

// Setup Sendgrid client
sgClient.setApiKey(functions.config().sendgrid.api_key);
sgClient.setDefaultRequest('baseUrl', 'https://api.sendgrid.com/');

async function sendEmailToNewMember(user_id, data) {
    const email_data = {
        "from": {
            "email": `${functions.config().sendgrid.from_email}`,
            "name": `${functions.config().sendgrid.from_name}`
        },
        "personalizations": [
            {
                "to": [
                    {
                        "email": `${data.email}`
                    }
                ],
                "dynamic_template_data": {
                    "name": `${data.first_name} ${data.last_name}`,
                    "email": `${data.email}`,
                    "minecraft_username": `${data.minecraft_username}`,
                    "user_id": `${user_id}`,
                    "verification_code": `${data.verification_code}`
                }
            }
        ],
        "template_id": `${functions.config().sendgrid.template_id}`
    };

    const email_request = {
        "body": email_data,
        "method": "POST",
        "url": "/v3/mail/send"
    };

    const response = await sgClient.request(email_request);
    console.log(
        `Email sent to ${data.email} for user ${user_id}. `,
        `Got back response ${response}`);
}

exports.onNewMember = functions.region(default_region)
    .firestore
    .document(`${default_collection}/{userID}`)
    .onCreate(async (doc, context) => {
        const data = doc.data();
        const id = doc.id;
        const verification_code = uuidv4();
        console.log(`Got document ${id}`);

        // Add verification status and code to the document
        data.is_verified = false;
        data.verification_code = verification_code;
        //doc.set(data);
        db.collection(default_collection).doc(id).set(data);

        // Then fire off an email!
        await sendEmailToNewMember(id, data);
        return;
    });
