FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
# Le paquet Emergent (rapport IA avec EMERGENT_LLM_KEY) est installé d'abord : les versions
# corrigées de requirements.txt (FastAPI, pymongo…) s'appliquent ensuite et ont le dernier mot.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir "emergentintegrations==0.2.0" \
       --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/ \
    && pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --uid 1000 app
USER app

# --forwarded-allow-ips : l'API n'est joignable que via Traefik, qui transmet l'IP réelle du visiteur
# (indispensable à la limitation du nombre de requêtes par IP).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
