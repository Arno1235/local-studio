#!/bin/sh
set -eu
mkdir -p /mlflow/artifacts
exec mlflow server \
  --host 0.0.0.0 \
  --port 5000 \
  --backend-store-uri sqlite:////mlflow/mlflow.db \
  --serve-artifacts \
  --artifacts-destination /mlflow/artifacts \
  --allowed-hosts '*' \
  --cors-allowed-origins '*'
