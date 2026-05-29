@echo off
python scripts\reset_db.py
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload
