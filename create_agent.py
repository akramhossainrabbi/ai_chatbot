"""
Run this once to create the first agent account:
  python create_agent.py
"""
import bcrypt
from app.database import SessionLocal, engine, Base
from app.models import Agent

Base.metadata.create_all(bind=engine)

username  = input("Username: ").strip()
password  = input("Password: ").strip()
full_name = input("Full name: ").strip()

hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

db = SessionLocal()
agent = Agent(username=username, password_hash=hashed, full_name=full_name)
db.add(agent)
db.commit()
print(f"\nAgent '{full_name}' created successfully (id={agent.id})")
db.close()
