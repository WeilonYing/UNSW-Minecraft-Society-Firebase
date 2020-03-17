# UNSW Minecraft Society Firebase

Firebase repo for UNSW Minecraft Society. 

## Overview
Minecraft Society currently uses Google Firebase to automate and handle the process of welcoming new members
and verifying their email addresses, including:
- Adding new members to Cloud Firestore
- Adding a verification code
- Sending a welcome email to the user, including the verification code with instructions on how to use it
- Verifying that the verification code is correct through a HTTPS endpoint
- Retrieving member information from Cloud Firestore

## Setup
1. Clone this repo.
2. Set up your Firebase project on https://firebase.google.com. Follow the steps to set up your project. For better control, this
    project saves the relevant Firebase modules locally instead of globally (Firebase setup instructions currently tells you to use global)
3. Run `npm install` in the root directory of this repo, and in the `functions` directory
4. Make your changes, and deploy your project with `npm run-script firebase deploy --only functions`

**Please note:** This project uses configuration variables that you must set using the Firebase CLI. Check the comments in `functions/index.js` for more information.
