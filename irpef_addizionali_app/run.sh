#!/usr/bin/env bash
export DATA_DIR=./data
mkdir -p $DATA_DIR
uvicorn main:app --host 0.0.0.0 --port 8000
