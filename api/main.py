from fastapi import FastAPI
from routers import auth, devices, songs, sync, download

app = FastAPI(title="Music Assistant")

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(songs.router)
app.include_router(sync.router)
app.include_router(download.router)

# Static files added in Task 11 after web build exists
