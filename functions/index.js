/* Cloud function to send an email to a new member to welcome them, provide
 * introductory information and most importantly, provide a verification key so
 * they can join the society Discord server.
 *
 * This function requires the following Firebase config values to be set:
 * sendgrid.api_key             API key to access Sendgrid's email service
 * sendgrid.template_id         Unique ID for the dynamic template to send the email through
 * sendgrid.from_email          Email that the user should reply to
 * sendgrid.from_name           The name of the sender (i.e. us)
 * settings.default_collection  The collection to use by default
 * settings.whitelist_url       The URL to send the whitelist request to
 * settings.auth_key            The key that the addUser HTTPS request must pass to its API header
 * For more information, see here https://firebase.google.com/docs/functions/config-env
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const sgClient = require('@sendgrid/client');
const uuidv4 = require('uuid/v4');
const request = require('request');

// Closest region to Sydney supporting cloud functions
const default_region = 'asia-northeast1'; // Tokyo
const default_collection = functions.config().settings.default_collection;
admin.initializeApp(functions.config().firebase);

const db = admin.firestore();

// Setup Sendgrid client
sgClient.setApiKey(functions.config().sendgrid.api_key);
sgClient.setDefaultRequest('baseUrl', 'https://api.sendgrid.com/');

/* Send email with welcome and verification information to the user
 * @param user_id   user's Firebase doc id
 * @param data      user's Firebase doc data
 */
async function sendEmailToNewMember(user_id, data) {
    // Try UNSW email first
    let to_email = null;
    let unsw_email = 'N/A';
    if (data.unsw_id) {
        to_email = `${data.unsw_id}@ad.unsw.edu.au`;
        unsw_email = to_email;
    } else {
        to_email = data.email;
    }
    const minecraft_username = data.minecraft_username || '<none given>';
    const discord_username = data.discord_username || '<none given>';

    console.log(to_email);
    const email_data = {
        "from": {
            "email": `${functions.config().sendgrid.from_email}`,
            "name": `${functions.config().sendgrid.from_name}`
        },
        "personalizations": [
            {
                "to": [
                    {
                        "email": `${to_email}`
                    }
                ],
                "dynamic_template_data": {
                    "name": `${data.first_name} ${data.last_name}`,
                    "email": `${data.email}`,
                    "unsw_email": `${unsw_email}`,
                    "minecraft_username": `${minecraft_username}`,
                    "discord_username": `${discord_username}`,
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
        `Email sent to ${to_email} for user ${user_id}. `,
        `Got back response ${response}`);
}

/* Send a whitelist request to Minecraft server
 * Requires settings.whitelist_url (e.g. http://url.com:<port>)
 * to be set in Firebase config, and the Autowhitelister plugin
 * installed on the server.
 */
function whitelistMinecraftUsername(minecraft_username) {
    request.post(
        {
            url: `${functions.config().settings.whitelist_url}`,
            form: { "username": `${minecraft_username}` }
        },
        (err, response, body) => {
            if (err) {
                return console.error(err);
            }
            console.log('Whitelist request sent. Got back ', body);
            return;
        }
    );
}

/* Add verification code to new member and fire off an email.
 * This function is triggered whenever there's a new entry
 * in the Firestore collection.
 *
 * The following must be provided in the doc data:
 * @param first_name            Passed to verification email
 * @param last_name             Passed to verification email
 * @param minecraft_username    Passed to verification email
 * @param email OR unsw_id   So that we have an email to send to
 */
exports.onNewMember = functions.region(default_region)
    .firestore
    .document(`${default_collection}/{userID}`)
    .onCreate(async (doc, context) => {
        const data = doc.data();
        const id = doc.id;
        const verification_code = uuidv4();
        console.log(`Got document ${id}`);

        if (!data.email && !data.unsw_id) {
            throw new Error("Both fields 'email' and 'unsw_id' are empty!");
        }

        // Add verification status and code to the document
        data.is_verified = false;
        data.verification_code = verification_code;
        db.collection(default_collection).doc(id).set(data);

        // Whitelist the user
        if (data.minecraft_username) {
            whitelistMinecraftUsername(data.minecraft_username);
        }

        // Then fire off an email!
        await sendEmailToNewMember(id, data);
        return;
    });

// HTTPS API endpoint to add a new member.
// Content-Type should be application/json
// Header should have this parameter:
//     "Authorization": <string>
//     "Content-Type": application/json
// JSON should be like this:
// {
//     "timestamp": <string>,
//     "first_name": <string>,
//     "last_name": <string>,
//     "email": <string>,
//     "discord_username": <string>,
//     "minecraft_username": <string>,
//     "unsw_id": <string>
// }
//
// Returns HTTP response (200 OK, or some error code)
//
exports.addUser = functions
    .region(default_region)
    .https.onRequest(async (req, res) => {
        if (req.method !== 'PUT') {
            return res.status(405).send('Incorrect method');
        }
        if (!req.header('Authorization')
            || req.header('Authorization') !== functions.config().settings.auth_key) {
            console.error('Unauthorized key sent: ', req.header('Authorization'));
            return res.status(401).send('Unauthorized');
        }

        console.log('Received add user request. Request body: ', req.body);
        const timestamp = req.body.timestamp;
        const first_name = req.body.first_name;
        const last_name = req.body.last_name;
        const email = req.body.email;
        const discord_username = req.body.discord_username || null;
        const minecraft_username = req.body.minecraft_username || null;
        const unsw_id = req.body.unsw_id || null;

        try {
            const addDoc = await db.collection(default_collection).add(
                {
                    timestamp: timestamp,
                    first_name: first_name,
                    last_name: last_name,
                    email: email,
                    discord_username: discord_username,
                    minecraft_username: minecraft_username,
                    unsw_id: unsw_id,
                }
            );
            console.log('Added new doc with ID: ', addDoc.id);
            return res.status(200).send('OK');
        } catch (err) {
            console.error(err);
            return res.status(500).send('Internal server error');
        }

        /* WARNING: Remember to ensure that this function will always return a response!
         * To test, uncomment the line below and run the linter. If linter says the line
         * below is unreachable, you may re-comment it and continue to deploy
         */
        // return res.status(500).send('Internal server error');
    });


// HTTPS API endpoint to verify user.
// Content-Type should be application/json
// JSON should be like this:
// {
//     "user_id": <string>,
//     "verification_code": <string>,
//     "discord_id": <string>
// }
//
// Returns JSON like this:
// {
//     "is_verified": <boolean>
// }
exports.verifyUser = functions
    .region(default_region)
    .https.onRequest(async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Incorrect method');
        }

        console.log('Received verification request. Request body: ', req.body);
        const user_id = req.body.user_id;
        const verification_code = req.body.verification_code;
        const discord_id = req.body.discord_id;

        if (!user_id || !verification_code || !discord_id) {
            return res.status(400).send('Invalid data provided');
        }
        const userRef = db.collection(default_collection).doc(user_id);

        try {
            const userDoc = await userRef.get();
            if (!userDoc.exists) {
                return res.status(401).send('User does not exist');
            }

            const userData = userDoc.data();

            // If user is already verified, skip this and return their verification status
            if (!userData.is_verified) {
                if (verification_code === userData.verification_code) {
                    userData.is_verified = true;
                    userData.discord_id = discord_id;
                    db.collection(default_collection).doc(user_id).set(userData);
                }
            }
            res.setHeader('Content-Type', 'application/json');
            return res.json({"is_verified": userData.is_verified});
        } catch (err) {
            console.log('Error getting document', err);
            return res.status(500).send('Internal server error');
        }

        /* WARNING: Remember to ensure that this function will always return a response!
         * To test, uncomment the line below and run the linter. If linter says the line
         * below is unreachable, you may re-comment it and continue to deploy
         */
        // return res.status(500).send('Internal server error');
    });

// HTTPS API endpoint to search for a member by Discord ID
// Content-Type should be application/json
// Header should have this parameter:
//     "Authorization": <string>
//     "Content-Type": application/json
// JSON should be like this:
// {
//     "discord_id": <string> <optional>,
//     "minecraft_username": <string> <optional>
// }
//
// Returns HTTP response (200 OK, or some error code)
//
exports.findUser = functions
    .region(default_region)
    .https.onRequest(async (req, res) => {
        if (req.method !== 'POST') {
            return res.status(405).send('Incorrect method');
        }
        if (!req.header('Authorization')
            || req.header('Authorization') !== functions.config().settings.auth_key) {
            console.error('Unauthorized key sent: ', req.header('Authorization'));
            console.log('Correct key: ', functions.config().settings.auth_key);
            return res.status(401).send('Unauthorized');
        }

        console.log('Received search user request. Request body: ', req.body);
        const discord_id = req.body.discord_id || null;
        const minecraft_username = req.body.minecraft_username || null;
        if (!discord_id && !minecraft_username) {
            return res.status(400).send('Bad request');
        }

        try {
            let query = db.collection(default_collection);
            if (discord_id) {
                query = query.where('discord_id', '==', discord_id);
            }
            if (minecraft_username) {
                query = query.where('minecraft_username', '==', minecraft_username);
            }
            const result = await query.get();

            const payload = [];
            if (!result.empty) {
                result.forEach(doc => {
                    payload.push(doc.data());
                });
            }
            return res.json({ "results": payload });
        } catch (err) {
            console.error(err);
            return res.status(500).send('Internal server error');
        }

        /* WARNING: Remember to ensure that this function will always return a response!
         * To test, uncomment the line below and run the linter. If linter says the line
         * below is unreachable, you may re-comment it and continue to deploy
         */
        // return res.status(500).send('Internal server error');
    });


