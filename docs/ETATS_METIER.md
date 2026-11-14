# États Métier & Transitions — SoliShare

Ce document fixe le vocabulaire unique partagé entre la base PostgreSQL, l'API Node.js et l'application mobile.

## 1. États d'une Offre (`offer_status`)
* **`disponible`** : Offre publiée, visible sur la carte/liste, ouverte à la réservation.
* **`reserve`** : Offre verrouillée par une réservation active unique (`SELECT ... FOR UPDATE`). Retirée du catalogue public.
* **`retire`** : Offre clôturée définitivement (soit après validation du retrait par QR code, soit annulée/modérée par le propriétaire ou un administrateur).
* **`expire`** : Offre non retirée dont la date limite `expires_at` est dépassée.

### Transitions autorisées (`offers`)
| État initial | Événement / Route API | État final | Conséquences |
| :--- | :--- | :--- | :--- |
| *(création)* | `POST /api/offers` | `disponible` | Visible par les bénéficiaires dans le rayon GPS. |
| `disponible` | `POST /api/reservations` | `reserve` | Création d'une réservation `active` + jeton QR unique. |
| `reserve` | `PATCH /api/reservations/:id/cancel` | `disponible` | Si `expires_at > NOW()`, l'offre redevient réservable. |
| `reserve` | `POST /api/reservations/validate` | `retire` | Réservation passe en `validee`, QR invalidé, points attribués. |
| `disponible` / `reserve` | `PATCH /api/admin/offers/:id/cancel` | `retire` | Réservation `active` associée passe en `annulee`. |
| `disponible` / `reserve` | CRON `expiration.job.js` (`expires_at <= NOW()`) | `expire` | Réservation `active` associée passe en `expiree`. |

---

## 2. États d'une Réservation (`reservation_status`)
* **`active`** : Réservation en cours en attente de retrait physique chez le commerçant/donateur.
* **`validee`** : Retrait confirmé par scan ou saisie du code QR (état terminal, anti-rejeu garanti).
* **`annulee`** : Réservation annulée par le bénéficiaire ou par modération administrative.
* **`expiree`** : Réservation non honorée avant l'expiration de l'offre.

### Transitions autorisées (`reservations`)
| État initial | Événement / Route API | État final | Conséquences |
| :--- | :--- | :--- | :--- |
| *(création)* | `POST /api/reservations` | `active` | L'offre liée passe en `reserve`. |
| `active` | `POST /api/reservations/validate` | `validee` | L'offre passe en `retire` ; attribution des points d'impact (`impact_events`). |
| `active` | `PATCH /api/reservations/:id/cancel` | `annulee` | L'offre repasse en `disponible` (si non expirée). |
| `active` | CRON `expiration.job.js` | `expiree` | L'offre liée passe en `expire`. |
