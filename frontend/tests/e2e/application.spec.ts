import { expect, test } from "@playwright/test";

const libraryFixture = {
  items: [
    {
      job_id: "4048eaf4-4d1e-4bfe-920f-1954c6201ad6",
      title: "Sad Melancholic Blues Solo in G Minor",
      source_type: "youtube",
      created_at: 1_700_000_000,
      completed_at: 1_700_000_600,
      duration_seconds: 129,
      download_url:
        "/api/jobs/4048eaf4-4d1e-4bfe-920f-1954c6201ad6/download",
      stems: ["vocals", "drums", "bass", "guitar", "piano", "other"].map(
        (id) => ({
          id,
          name: id,
          stream_url: `/api/jobs/4048eaf4-4d1e-4bfe-920f-1954c6201ad6/stems/${id}`,
          download_url: `/api/jobs/4048eaf4-4d1e-4bfe-920f-1954c6201ad6/stems/${id}/download`,
        }),
      ),
    },
  ],
};

const authenticatedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Davi Ramos",
  email: "davi@example.com",
  has_password: true,
  google_connected: true,
  avatar_url: "https://profiles.example.test/davi.png",
  created_at: 1_700_000_000,
};
test("Home loads both source choices without a delayed script injection", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "./favicon.svg");
  await expect(page.getByRole("tab", { name: "Arquivo" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "YouTube" })).toBeVisible();
  await page.getByRole("tab", { name: "YouTube" }).click();
  await expect(page.getByLabel("URL do YouTube")).toBeVisible();
});

test("guest actions open the authentication gate", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /selecionar arquivo/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: /entre antes de enviar/i })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  const libraryLink = page.getByRole("link", { name: /minhas músicas/i });
  if (await libraryLink.isVisible()) {
    await libraryLink.click();
    await expect(page).not.toHaveURL(/musics\.html/);
    await expect(page.getByRole("heading", { name: /biblioteca é particular/i })).toBeVisible();
  }
});

test("direct library access is locked for a guest", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.goto("/musics.html#library");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/suas músicas ficam protegidas aqui/i)).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("link", { name: /^entrar$/i })).toHaveAttribute(
    "href",
    /auth\.html\?next=/,
  );
});

test("authentication page offers e-mail, Google, and password recovery", async ({
  page,
}) => {
  await page.goto("/auth.html");
  await expect(page.getByRole("heading", { name: "Bem-vindo de volta" })).toBeVisible();
  await expect(page.getByRole("link", { name: /continuar com google/i })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await page.getByRole("button", { name: /esqueci minha senha/i }).click();
  await expect(page.getByRole("heading", { name: "Recupere sua conta" })).toBeVisible();
});
test("library opens a six-track mixer with an enabled transport", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: authenticatedUser }) }),
  );

  await page.route(authenticatedUser.avatar_url, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    }),
  );
  await page.route("**/api/library", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(libraryFixture) }),
  );
  await page.goto("/musics.html#library");
  await page.getByRole("link", { name: /abrir mixer/i }).click();
  await expect(page.locator(".account-avatar img")).toHaveAttribute("src", authenticatedUser.avatar_url);
  await expect(page.locator(".mixer-track")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Reproduzir" })).toBeEnabled();
  await expect(page.locator(".nav-links a.active")).toHaveText("Minhas Músicas");
});


test("visitor can create an account and reach a private empty library", async ({
  page,
}) => {
  let authenticated = false;
  const user = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Davi Ramos",
    email: "davi@example.com",
    has_password: true,
    google_connected: false,
    avatar_url: null,
    created_at: 1_700_000_000,
  };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      body: JSON.stringify(
        authenticated
          ? { user }
          : { error: { code: "UNAUTHENTICATED", message: "Entre na sua conta." } },
      ),
    }),
  );
  await page.route("**/api/auth/register", (route) => {
    authenticated = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ user }),
    });
  });
  await page.route("**/api/library", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    }),
  );

  await page.goto("/auth.html?mode=register&next=musics.html");
  await page.getByLabel("Nome").fill("Davi Ramos", { force: true });
  await page.getByLabel("E-mail").fill("davi@example.com", { force: true });
  await page.locator('input[type="password"]').nth(0).fill("guitarra-segura-123", { force: true });
  await page.locator('input[type="password"]').nth(1).fill("guitarra-segura-123", { force: true });
  await page.getByRole("button", { name: "Criar conta" }).click({ force: true });

  await expect(page).toHaveURL(/musics\.html/);
  await expect(page.getByRole("heading", { name: "Minhas músicas" })).toBeVisible();
  await expect(page.getByText("Sua biblioteca está esperando a primeira música")).toBeVisible();
  await expect(page.getByRole("link", { name: "Davi Ramos" })).toBeVisible();
});
