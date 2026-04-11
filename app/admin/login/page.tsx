export default function AdminLoginPage() {
  return (
    <main>
      <h1>RecoveryStack Admin Login</h1>
      <form method="post" action="/api/admin/login">
        <label htmlFor="password">Admin password</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}
