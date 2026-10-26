# Crée (ou répare) un compte administrateur sans passer par le code de confirmation envoyé par e-mail.
# Réservé à qui a accès au serveur ; l'adresse doit figurer dans ADMIN_EMAILS pour donner l'accès admin.
#   docker compose exec backend python create_admin.py admin@breachradar.fr
import asyncio
import getpass
import sys
import uuid

from accounts import is_admin, normalize, now
from security import hash_password
from server import db


async def create_admin(email: str, password: str) -> dict:
    email = normalize(email)
    user = await db.users.find_one({"email": email}, {"_id": 0})
    fields = {"password_hash": hash_password(password), "email_verified": True,
              "login_failures": 0, "locked_until": None}
    if user:
        await db.users.update_one({"id": user["id"]}, {"$set": fields})
    else:
        await db.users.insert_one({"id": str(uuid.uuid4()), "email": email, "created_at": now().isoformat(), **fields})
    return await db.users.find_one({"email": email}, {"_id": 0})


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("Usage : python create_admin.py ADRESSE_EMAIL")
    password = getpass.getpass("Mot de passe (8 caractères minimum) : ")
    if len(password) < 8 or len(password) > 128:
        sys.exit("Le mot de passe doit faire entre 8 et 128 caractères.")
    if getpass.getpass("Confirmez le mot de passe : ") != password:
        sys.exit("Les mots de passe ne correspondent pas.")
    user = asyncio.run(create_admin(sys.argv[1], password))
    print(f"Compte {user['email']} prêt (adresse vérifiée).")
    if not is_admin(user):
        print("Attention : cette adresse n'est pas dans ADMIN_EMAILS, le compte n'aura pas accès à l'administration.")


if __name__ == "__main__":
    main()
