FROM python:3.12.8-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir mlflow==3.15.1
WORKDIR /mlflow
EXPOSE 5000
COPY new-vm/docker/mlflow/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
