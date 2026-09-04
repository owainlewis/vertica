#!/bin/sh
# Deploys Vertica to Cloud Run from source. Needs an authenticated gcloud CLI.
set -eu

PROJECT="${PROJECT:-vertica-prod}"
REGION="${REGION:-europe-west2}"
SERVICE="${SERVICE:-vertica}"
BUCKET="${BUCKET:-${PROJECT}-store}"
SECRET="${SECRET:-vertica-app-secret}"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --set-env-vars "BUCKET=$BUCKET" \
  --set-secrets "APP_SECRET=$SECRET:latest" \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3
