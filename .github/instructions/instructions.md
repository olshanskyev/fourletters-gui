# Project Context: fourletters-gui

This document provides context for the `fourletters-gui` project, an Angular-based PWA application.

## Project Overview

Key technologies used in this project include:
- **Angular 20+**: The core framework for the application.
- **Angular Material**: For UI components.
- **Vitest**: For running unit tests.
- **ESLint** and **Prettier**: For code linting and formatting.

## Building and Running

### Prerequisites

- Node.js and npm

### Installation

To install the project dependencies, run the following command in the project's root directory:

```bash
npm install
```

### Development Server

To start the development server, run:

```bash
npm start
```

This will start a local development server at `https://localhost`. The application will automatically reload when source files are changed.

### Building

To build the project for production, run:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

### Running Unit Tests

To run the unit tests, use the following command:

```bash
npm test
```

## Development Conventions

### Coding Style

The project uses ESLint and Prettier to enforce a consistent coding style. Before committing any changes, it is recommended to run the following command to lint and format the code:

```bash
npm run lint
```

### Architecture

The application follows a standard Angular architecture with the following key components:

- **`src/app/core`**: Contains the core services, models, and interceptors for the application.
- **`src/app/routes`**: Contains the different routes of the application, such as the dashboard, admin section, and session pages.
- **`src/app/shared`**: Contains shared components, directives, and pipes that are used throughout the application.
- **`src/app/theme`**: Contains the theming and layout components for the application.
- **`public`**: Contains static assets such as images, fonts, and data files.

### Additional Coding Preferences
- Keep project dependencies minimal
- Use styles already defined in project
- Use relative imports for neigbors and path aliases for outer packages
- Use apostrophes for strings declarations
- Use angular material components where possible
- Use angular material color variables
- use @for and @if, and not *ngIf and *ngFor
- use css classes like "d-flex flex-col p-8 ..." instead of custom classes
- do not modify objects inside dto folder
