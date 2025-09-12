# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Development
- `npm start` - Start the LaTeX compilation service on port 3000 (or PORT env variable)
- `npm install` - Install dependencies

### Deployment
- Docker build: `docker build -t latex-service .`
- The service auto-deploys on Railway when pushed to main branch

## Architecture Overview

### Service Structure
This is a Node.js/Express REST API service that compiles LaTeX documents to PDF with automatic error fixing using Claude Sonnet.

**Core Components:**
1. **server.js** - Main Express server with three endpoints:
   - `GET /` - Service info
   - `GET /health` - Health check (verifies pdflatex availability)
   - `POST /compile` - LaTeX to PDF compilation with AI error fixing

2. **llmService.js** - Claude Sonnet integration for automatic LaTeX error fixing
   - Uses Anthropic SDK with Claude Sonnet model
   - Attempts to fix compilation errors automatically
   - Returns clean LaTeX code without explanations

### Key Features
- **Auto-retry compilation** - Up to 3 attempts with AI-powered error fixing
- **Error extraction** - Parses LaTeX logs to provide user-friendly error messages
- **Temporary file management** - Creates isolated `/tmp/latex-{uuid}` directories for each compilation job
- **Docker deployment** - Uses texlive/texlive:latest base image with Node.js 18

### Environment Variables
- `PORT` - Server port (default: 3000, auto-set by Railway)
- `ANTHROPIC_API_KEY` - Required for AI error fixing functionality

### API Request Format
POST /compile accepts:
```json
{
  "latex": "LaTeX document content",
  "autoFix": true  // Optional, enables AI error fixing (default: true)
}
```

Returns PDF binary on success or detailed error JSON on failure.