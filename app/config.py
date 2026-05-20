from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    groq_api_key: str = ""
    gemini_api_key: str = ""

    db_host: str = "localhost"
    db_port: int = 3306
    db_name: str = "chatbot_db"
    db_user: str = "root"
    db_password: str = ""

    secret_key: str = "change_me"
    access_token_expire_minutes: int = 480

    base_url: str = "http://localhost:8000"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
