require("dotenv").config();
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");
const pool = require("../src/db");

let server;
let baseUrl;
const runId = Date.now();

const merchantEmail = `test-merchant-${runId}@solishare.fr`;
const student1Email = `test-student1-${runId}@solishare.fr`;
const student2Email = `test-student2-${runId}@solishare.fr`;
const password = "TestPassword2026!";

let merchantToken;
let student1Token;
let student2Token;
let merchantId;
let student1Id;
let student2Id;
let flashOfferId;
let reservationId;
let qrToken;

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}/api`;
      resolve();
    });
  });
});

after(async () => {
  const userIds = [merchantId, student1Id, student2Id].filter(Boolean);
  if (userIds.length > 0) {
    await pool.query("DELETE FROM impact_events WHERE user_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM reservations WHERE receiver_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM offers WHERE owner_id = ANY($1::uuid[])", [userIds]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  }
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test("1. Inscription et connexion des comptes commerÃ§ant et particuliers", async () => {
  // 1. Inscriptions
  const regM = await api("/auth/register", {
    method: "POST",
    body: { full_name: "Boulangerie Test", email: merchantEmail, password, role: "commercant", siret: "12345678901234", business_address: "12 Rue de la République, 38000 Grenoble" }
  });
  assert.equal(regM.status, 201);

  const regS1 = await api("/auth/register", {
    method: "POST",
    body: { full_name: "Ã‰tudiant Un", email: student1Email, password, role: "particulier" }
  });
  assert.equal(regS1.status, 201);

  const regS2 = await api("/auth/register", {
    method: "POST",
    body: { full_name: "Ã‰tudiant Deux", email: student2Email, password, role: "particulier" }
  });
  assert.equal(regS2.status, 201);

  // 2. Connexions pour rÃ©cupÃ©rer les jetons JWT
  const logM = await api("/auth/login", {
    method: "POST",
    body: { email: merchantEmail, password }
  });
  assert.equal(logM.status, 200);
  assert.ok(logM.data.token);
  merchantToken = logM.data.token;
  merchantId = logM.data.user.id;
  await pool.query("UPDATE users SET is_verified = true WHERE id = $1", [merchantId]);

  const logS1 = await api("/auth/login", {
    method: "POST",
    body: { email: student1Email, password }
  });
  assert.equal(logS1.status, 200);
  student1Token = logS1.data.token;
  student1Id = logS1.data.user.id;

  const logS2 = await api("/auth/login", {
    method: "POST",
    body: { email: student2Email, password }
  });
  assert.equal(logS2.status, 200);
  student2Token = logS2.data.token;
  student2Id = logS2.data.user.id;
});

test("2. RBAC : Particulier bloquÃ© sur vente_flash (403) mais autorisÃ© sur don (201)", async () => {
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();

  const forbiddenFlash = await api("/offers", {
    method: "POST",
    token: student1Token,
    body: {
      title: "Vente flash interdite",
      category: "alimentaire",
      offer_type: "vente_flash",
      price_cents: 300,
      longitude: 5.7672,
      latitude: 45.1932,
      address_label: "Campus UGA",
      expires_at: expiresAt
    }
  });
  assert.equal(forbiddenFlash.status, 403);

  const allowedDon = await api("/offers", {
    method: "POST",
    token: student1Token,
    body: {
      title: "Don de pÃ¢tes entre Ã©tudiants",
      category: "alimentaire",
      offer_type: "don",
      price_cents: 0,
      longitude: 5.7672,
      latitude: 45.1932,
      address_label: "RÃ©sidence Universitaire",
      expires_at: expiresAt
    }
  });
  assert.equal(allowedDon.status, 201);
});

test("3. Publication d'une vente flash par un commerÃ§ant et recherche gÃ©olocalisÃ©e", async () => {
  const expiresAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();

  const created = await api("/offers", {
    method: "POST",
    token: merchantToken,
    body: {
      title: "Panier Anti-Gaspi Test",
      description: "Viennoiseries et pains du jour",
      category: "alimentaire",
      offer_type: "vente_flash",
      price_cents: 250,
      longitude: 5.7675,
      latitude: 45.1935,
      address_label: "Avenue Centrale, Saint-Martin-d'HÃ¨res",
      expires_at: expiresAt
    }
  });
  assert.equal(created.status, 201);
  flashOfferId = created.data.offer.id;

  const nearby = await api("/offers/nearby?longitude=5.7675&latitude=45.1935&radius_m=1000", {
    token: student1Token
  });
  assert.equal(nearby.status, 200);
  assert.ok(nearby.data.offers.some((o) => o.id === flashOfferId));
});

test("4. Concurrence : deux rÃ©servations simultanÃ©es sur la mÃªme offre (1x 201, 1x 409)", async () => {
  const [res1, res2] = await Promise.all([
    api("/reservations", { method: "POST", token: student1Token, body: { offer_id: flashOfferId } }),
    api("/reservations", { method: "POST", token: student2Token, body: { offer_id: flashOfferId } })
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  const winner = res1.status === 201 ? res1.data.reservation : res2.data.reservation;
  reservationId = winner.id;
  qrToken = winner.qr_token;
  assert.ok(qrToken && qrToken.includes(":"));
});

test("5. Validation QR code, blocage de rÃ©utilisation (409) et points d'impact", async () => {
  // Un Ã©tudiant ne peut pas valider le QR code d'un commerÃ§ant (403)
  const wrongRole = await api("/reservations/validate-qr", {
    method: "POST",
    token: student2Token,
    body: { qr_token: qrToken }
  });
  assert.equal(wrongRole.status, 403);

  // Le commerÃ§ant propriÃ©taire valide le QR code (200)
  const valid = await api("/reservations/validate-qr", {
    method: "POST",
    token: merchantToken,
    body: { qr_token: qrToken }
  });
  assert.equal(valid.status, 200);

  // Tentative de rejeu du mÃªme QR code -> doit Ã©chouer (409)
  const replay = await api("/reservations/validate-qr", {
    method: "POST",
    token: merchantToken,
    body: { qr_token: qrToken }
  });
  assert.equal(replay.status, 409);

  // VÃ©rification des points attribuÃ©s au commerÃ§ant (+10)
  const stats = await api("/offers/stats/me", { token: merchantToken });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.impact.total_points, 10);
  assert.equal(stats.data.offers.redeemed_offers, 1);
});

test("6. Sécurité P0 : Révocation de session via POST /api/auth/logout (401 immédiat)", async () => {
  const logoutRes = await api("/auth/logout", { method: "POST", token: student2Token });
  assert.equal(logoutRes.status, 200);

  const meAfter = await api("/auth/me", { token: student2Token });
  assert.equal(meAfter.status, 401);
});

test("7. Médias & GPS P1 : Rejet point nul (0,0) et signature fichier invalide", async () => {
  const expiresAt = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const badGps = await api("/offers", {
    method: "POST",
    token: student1Token,
    body: {
      title: "Don GPS invalide",
      category: "alimentaire",
      offer_type: "don",
      price_cents: 0,
      longitude: 0,
      latitude: 0,
      address_label: "Null Island",
      expires_at: expiresAt
    }
  });
  assert.equal(badGps.status, 400);

  const fakeImgRes = await fetch(`${baseUrl}/offers/upload-photo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${student1Token}`,
      "Content-Type": "image/png"
    },
    body: Buffer.from("ceci-nest-pas-un-png")
  });
  assert.equal(fakeImgRes.status, 400);
});

test("8. Modération P1 : Signalement utilisateur et traitement administrateur", async () => {
  const repRes = await api("/reports", {
    method: "POST",
    token: student1Token,
    body: {
      target_type: "user",
      target_id: merchantId,
      reason: "Test de signalement P1"
    }
  });
  assert.equal(repRes.status, 201);
  assert.equal(repRes.data.report.status, "ouvert");

  const adminLogin = await api("/auth/login", {
    method: "POST",
    body: { email: "admin@solishare.fr", password: "Admin2026Solishare" }
  });
  assert.equal(adminLogin.status, 200);

  const resolveRes = await api(`/admin/reports/${repRes.data.report.id}`, {
    method: "PATCH",
    token: adminLogin.data.token,
    body: { status: "resolu", admin_note: "Vérifié", suspend_target: false }
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.data.report.status, "resolu");
});