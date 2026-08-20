#!/bin/sh
set -eu
mkdir -p /mlflow/artifacts
exec mlflow server \
  --host 0.0.0.0 \
  --port 5000 \
  --backend-store-uri sqlite:////mlflow/mlflow.db \
  --default-artifact-root /mlflow/artifacts \
  --allowed-hosts '*'
