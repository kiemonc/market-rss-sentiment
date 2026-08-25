# Frontend

Simple Angular app that lists articles from the `articles` Firestore collection
(written by the consumer function in the parent project, see `../CLAUDE.md`) and
shows a preview of the selected one. It talks to Firestore directly from the
browser via the Firebase Web SDK — there is no backend API for this.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.2.27.

## Setup

Provisioning is normally done through Terraform (`../terraform/firebase.tf`) — see
"Frontend (Firebase)" in `../terraform/README.md`. Run `npm install` here once, then
`terraform apply` in `../terraform` registers the Firebase Web App, generates
`src/environments/environment.ts` and `firebase.json`/`.firebaserc`, deploys
`firestore.rules`, and builds + deploys this app to Firebase Hosting.

Doing it by hand instead (e.g. without touching Terraform state) also works:

1. In the [Firebase console](https://console.firebase.google.com/), open the GCP
   project this repo deploys to (`project_id` in `terraform/terraform.tfvars`),
   add a **Web app**, and copy its SDK config.
2. Copy `src/environments/environment.ts.example` to `environment.ts` and fill in
   that `apiKey`, `authDomain` and `projectId` (both files are gitignored/tracked
   the same way as `terraform.tfvars.example`/`terraform.tfvars`).
3. Deploy the security rules in `firestore.rules` (public **read-only** access to
   `articles`) so the browser is allowed to query the collection:
   ```bash
   npx firebase deploy --only firestore:rules --project <your-project-id>
   ```
   (requires the Firebase CLI: `npm install -g firebase-tools` and `firebase login`).

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
