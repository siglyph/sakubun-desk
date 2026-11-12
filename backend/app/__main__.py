"""Run the server:  python -m app"""
import uvicorn

from . import config

if __name__ == "__main__":
    print(f"Sakubun Desk: http://{'localhost' if config.HOST in ('127.0.0.1', '0.0.0.0') else config.HOST}:{config.PORT}")
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT)
