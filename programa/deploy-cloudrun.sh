# Deploy manual do Cloud Run (alternativa ao cloudbuild.yaml)
# Uso:
#   gcloud run deploy intelliquote-api \
#     --image southamerica-east1-docker.pkg.dev/sq-comex-updates-3d22f/intelliquote/intelliquote-api:latest \
#     --region southamerica-east1 --platform managed --allow-unauthenticated \
#     --port 8080 --memory 512Mi --cpu 1 --min-instances 0 --max-instances 4 \
#     --timeout 60 --concurrency 80 \
#     --add-cloudsql-instances sq-comex-updates-3d22f:southamerica-east1:intelliquote-db \
#     --set-env-vars NODE_ENV=production,CORS_ORIGINS=https://intelliquote.portal-comex.com,INTELLIQUOTE_PORTAL_URL=https://intelliquote.portal-comex.com \
#     --set-secrets SMTP_PASS=SMTP_PASS:latest,DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,JWT_ACCESS_SECRET=JWT_ACCESS_SECRET:latest,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:latest
