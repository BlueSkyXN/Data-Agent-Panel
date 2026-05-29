from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Data Agent Mock Agents")

class Payload(BaseModel):
    message: str
    context: dict = {}

@app.post("/echo")
def echo(payload: Payload):
    return {
        "answer": f"Mock HTTP Agent 收到：{payload.message}",
        "answer_type": "generic_http",
        "confidence": 0.5,
        "tables": [], "charts": [], "sql": [], "evidence": [],
        "warnings": ["这是独立 Mock Agent 服务。"],
        "next_actions": [],
    }
