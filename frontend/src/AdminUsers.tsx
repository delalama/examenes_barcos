import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "STUDENT";
  active: boolean;
  createdAt: string;
};

export default function AdminUsers({ api }: { api: (path: string, init?: RequestInit) => Promise<any> }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"STUDENT" | "ADMIN">("STUDENT");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadUsers() {
    setLoading(true);
    try {
      const result = await api("/admin/users");
      setUsers(result.users);
      setError("");
    } catch (e: any) {
      setError(e.message || "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, email, password, role }),
      });
      setUsers((current) => [result.user, ...current]);
      setNotice(`Usuario ${result.user.email} creado.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("STUDENT");
    } catch (e: any) {
      setError(e.message || "No se pudo crear el usuario.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="content admin-users-page">
    <div className="eyebrow">ADMINISTRACIÓN</div>
    <h1>Usuarios</h1>
    <p className="admin-users-intro">Crea cuentas de alumno o administrador. La contraseña se guarda cifrada.</p>

    <form className="card admin-user-form" onSubmit={createUser}>
      <h2>Añadir usuario</h2>
      <div className="admin-user-fields">
        <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoComplete="name" /></label>
        <label>Correo electrónico<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Contraseña inicial<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} maxLength={128} required autoComplete="new-password" /><small>Mínimo 10 caracteres.</small></label>
        <label>Rol<select value={role} onChange={(e) => setRole(e.target.value as "STUDENT" | "ADMIN")}><option value="STUDENT">Alumno</option><option value="ADMIN">Administrador</option></select></label>
      </div>
      <button className="primary" disabled={saving}>{saving ? "Creando…" : "Crear usuario"}</button>
      {notice && <p className="admin-user-notice" role="status">{notice}</p>}
      {error && <div className="error-inline" role="alert">{error}</div>}
    </form>

    <div className="section-title admin-user-list-heading"><div><div className="eyebrow">CUENTAS</div><h2>Usuarios registrados</h2></div><button className="outline" onClick={() => void loadUsers()} disabled={loading}>Actualizar</button></div>
    {loading ? <p className="empty">Cargando usuarios…</p> : users.length ? <div className="admin-user-list">{users.map((user) => <article className="card admin-user-row" key={user.id}>
      <div><b>{user.name}</b><span>{user.email}</span></div>
      <span className={`admin-user-role ${user.role === "ADMIN" ? "admin" : "student"}`}>{user.role === "ADMIN" ? "Administrador" : "Alumno"}</span>
      <small>{user.active ? "Activo" : "Desactivado"} · {new Date(user.createdAt).toLocaleDateString("es-ES")}</small>
    </article>)}</div> : <p className="empty">Todavía no hay usuarios.</p>}
  </div>;
}
