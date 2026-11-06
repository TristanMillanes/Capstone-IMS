"""PGENRO Admin setup and access recovery. Run locally with Python 3 (includes Tkinter).

Uses the Auth Admin API and the existing guarded promotion RPC.
No password, key, or browser credential is written to disk.
"""
from datetime import datetime, timezone
import json
import os
import queue
import re
import sys
import threading
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from uuid import UUID

DEFAULT_URL = "https://zssrxubajhqryrwijyzm.supabase.co"
DEFAULT_NUMBER = "A0001"


class SetupError(Exception):
    pass


def employee_number(value):
    number = value.strip() if isinstance(value, str) else ""
    number = re.sub(r"@pgenro\.ims$", "", number, flags=re.IGNORECASE)
    if (not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9._-]{0,59}", number)
            or number.endswith(".") or ".." in number):
        raise SetupError("Gumamit ng 1–60 letters, numbers, dots, underscores o hyphens sa Admin ID.")
    return number


class SupabaseAdmin:
    def __init__(self, url, key):
        self.url = url.strip().rstrip("/")
        parts = urlsplit(self.url)
        if (parts.scheme != "https" or not parts.hostname or parts.username
                or parts.password or parts.path or parts.query or parts.fragment):
            raise SetupError("Gamitin ang HTTPS Project URL, hindi ang Dashboard URL.")
        key = key.strip()
        if not key or key.startswith("sb_publishable_"):
            raise SetupError("I-paste ang secret key o legacy service_role key ng project.")
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if not key.startswith("sb_secret_"):
            self.headers["Authorization"] = "Bearer " + key

    def call(self, path, payload=None, method=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(self.url + path, data=data, headers=self.headers,
                          method=method or ("POST" if payload is not None else "GET"))
        try:
            with urlopen(request, timeout=30) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as error:
            if error.code in (401, 403):
                raise SetupError("Hindi tinanggap ang key. Gamitin ang secret o service_role key ng mismong project.") from None
            try:
                detail = json.loads(error.read().decode("utf-8", errors="replace"))
            except (ValueError, OSError):
                detail = {}
            if not isinstance(detail, dict):
                detail = {}
            message = (detail.get("msg") or detail.get("message")
                       or detail.get("error_description") or detail.get("error") or "Request failed")
            if not isinstance(message, str):
                message = "Request failed"
            private_values = [self.headers["apikey"]]
            if isinstance(payload, dict):
                private_values.append(payload.get("password", ""))
            for value in private_values:
                if value:
                    message = message.replace(value, "[hidden]")
            message = message[:400]
            if detail.get("code") == "PGRST202" or error.code == 404:
                message += "\nI-run muna ang EMPLOYEE_ID_LOGIN_PATCH.sql mula sa IMS project."
            elif error.code >= 500:
                message += "\nBuksan ang pinakabagong Authentication o Postgres error log para makita ang trigger na nag-fail."
            elif detail.get("code") in ("email_exists", "user_already_exists"):
                message += "\nMay account na sa ID na ito. Tingnan muna ang Authentication > Users."
            raise SetupError("HTTP " + str(error.code) + ": " + message) from None
        except (URLError, TimeoutError, OSError):
            raise SetupError(
                "Hindi nakumpirma ang request. Tingnan ang internet at Authentication > Users bago ulitin; "
                "posibleng natapos ang naunang request."
            ) from None
        except ValueError:
            raise SetupError("Hindi wastong JSON ang response ng project. Suriin ang Project URL.") from None


def setup(admin, password, number=DEFAULT_NUMBER, report=lambda message: None):
    number = employee_number(number)
    email = number.lower() + "@pgenro.ims"
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise SetupError("Pumili ng password na may 12–128 characters.")
    report("Sinusuri ang existing Admin...")
    active = admin.call("/rest/v1/profiles?" + urlencode({
        "select": "user_id", "role": "eq.Admin", "status": "eq.Active",
        "is_active": "eq.true", "limit": "1",
    }))
    if not isinstance(active, list):
        raise SetupError("Hindi masuri ang profiles. I-run muna ang account SQL patches.")
    if active:
        raise SetupError("May active Admin na. Mag-login gamit iyon at gamitin ang User Management para sa karagdagang accounts.")
    report("Ginagawa ang Auth account...")
    user = admin.call("/auth/v1/admin/users", {
        "email": email, "password": password, "email_confirm": True,
        "user_metadata": {
            "username": number, "full_name": "PGENRO Administrator",
            "requested_role": "Admin",
        },
        # The employee-registration trigger checks this SERVER-ONLY marker.
        # A user_metadata field with the same name does not provide a bypass.
        "app_metadata": {"created_by_admin": True},
    })
    user = user.get("user", user) if isinstance(user, dict) else None
    try:
        user_id = str(UUID(user["id"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise SetupError("Hindi nakumpirma ang account. Tingnan ang Authentication > Users bago ulitin.") from None
    recovery = (
        "Nagawa ang Auth account pero hindi nakumpirma ang Admin activation.\n"
        "Hindi kailangang gumawa ulit o magpalit ng password.\n"
        "Kung wala pang ibang active Admin, i-run sa SQL Editor:\n"
        "select public.promote_pgenro_first_admin('" + email + "');"
    )
    report("Ina-activate at vine-verify ang Admin profile...")
    try:
        result = admin.call("/rest/v1/rpc/promote_pgenro_first_admin", {"admin_email": email})
        if not isinstance(result, str) or not result.startswith("Admin enabled:"):
            raise SetupError("Hindi nakumpirma ang promotion.")
        rows = admin.call("/rest/v1/profiles?" + urlencode({
            "select": "role,status,is_active", "user_id": "eq." + user_id,
        }))
        if (not isinstance(rows, list) or len(rows) != 1
                or rows[0].get("role") != "Admin"
                or rows[0].get("status") != "Active" or rows[0].get("is_active") is not True):
            raise SetupError("Hindi nakumpirma ang active Admin profile.")
    except SetupError as error:
        raise SetupError(recovery + "\n\nDetalye: " + str(error)) from None
    return number


def _uuid(value):
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise SetupError('Hindi valid ang napiling account. Hanapin muli ang Admin.') from None


def _active_admin(profile):
    return (isinstance(profile, dict) and profile.get('role') == 'Admin'
            and profile.get('status') == 'Active' and profile.get('is_active') is True)


def _profile(admin, user_id):
    rows = admin.call('/rest/v1/profiles?' + urlencode({
        'select': 'user_id,username,email,employee_number,employee_record_id,role,status,is_active',
        'user_id': 'eq.' + _uuid(user_id),
    }))
    if (not isinstance(rows, list) or len(rows) != 1 or not _active_admin(rows[0])
            or _uuid(rows[0].get('user_id')) != _uuid(user_id)):
        raise SetupError('Hindi na active Admin ang account. Hanapin muli ang Admin bago mag-recover.')
    return rows[0]


def list_active_admins(admin):
    rows = admin.call('/rest/v1/profiles?' + urlencode({
        'select': 'user_id,username,email,role,status,is_active',
        'role': 'eq.Admin', 'status': 'eq.Active', 'is_active': 'eq.true',
        'order': 'username.asc.nullslast', 'limit': '1000',
    }))
    if not isinstance(rows, list):
        raise SetupError('Hindi mabasa ang Admin list. Suriin ang project URL at server key.')
    result = []
    for row in rows:
        if _active_admin(row):
            result.append({**row, 'user_id': _uuid(row.get('user_id'))})
    return result


def _login_id(admin, profile, auth_email):
    candidates = []
    if profile.get('employee_record_id'):
        rows = admin.call('/rest/v1/employees?' + urlencode({
            'select': '*', 'id': 'eq.' + str(profile['employee_record_id']),
        }))
        if isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict):
            row = rows[0]
            data = row.get('data') if isinstance(row.get('data'), dict) else {}
            payload = {**data, **{k: v for k, v in row.items() if k != 'data' and v is not None}}
            candidates.append(payload.get('employee_id'))
    candidates.extend([profile.get('employee_number'), profile.get('username'), auth_email.split('@')[0]])
    seen = set()
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        number = candidate.strip()
        if (number.lower() in seen or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}', number)
                or number.endswith('.') or '..' in number):
            continue
        seen.add(number.lower())
        resolved = admin.call('/rest/v1/rpc/pgenro_employee_login_email', {'p_employee_number': number})
        if isinstance(resolved, str) and resolved.lower() == auth_email.lower():
            return number
    raise SetupError('Hindi matukoy ang gumaganang login ID ng account. I-check muna ang Employee ID link; wala pang password na binago.')


def recover_admin(admin, password, user_id, report=lambda message: None):
    """Reset only the explicitly selected existing Admin through the Auth API."""
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise SetupError('Pumili ng bagong password na may 12-128 characters.')
    user_id = _uuid(user_id)
    report('Vine-verify ang napiling active Admin...')
    profile = _profile(admin, user_id)
    account = admin.call('/auth/v1/admin/users/' + user_id)
    account = account.get('user', account) if isinstance(account, dict) else None
    if (not isinstance(account, dict) or _uuid(account.get('id')) != user_id
            or not isinstance(account.get('email'), str) or not account['email']):
        raise SetupError('Hindi makumpirma ang Auth account. Hanapin muli ang Admin.')
    email = account['email']
    if str(profile.get('email') or '').lower() != email.lower():
        raise SetupError('Hindi magkatugma ang Auth at profile email. I-review muna ang account bago mag-recover.')
    if account.get('banned_until'):
        try:
            banned = datetime.fromisoformat(str(account['banned_until']).replace('Z', '+00:00'))
            if banned.tzinfo is None:
                banned = banned.replace(tzinfo=timezone.utc)
        except ValueError:
            raise SetupError('Hindi makumpirma ang Auth ban status. I-review muna ang account.') from None
        if banned > datetime.now(timezone.utc):
            raise SetupError('Naka-ban ang Auth account. I-review muna ang ban sa Supabase; hindi ito awtomatikong inaalis ng recovery.')
    number = _login_id(admin, profile, email)
    report('Pinapalitan ang password ng napiling Admin...')
    # Preserve the UUID, email, roles, HR links and all operational records.
    # Confirm the existing account as part of the explicit owner recovery.
    updated = admin.call('/auth/v1/admin/users/' + user_id,
                         {'password': password, 'email_confirm': True}, method='PUT')
    updated = updated.get('user', updated) if isinstance(updated, dict) else None
    if (not isinstance(updated, dict) or _uuid(updated.get('id')) != user_id
            or str(updated.get('email') or '').lower() != email.lower()):
        raise SetupError('Hindi nakumpirma ang password update. Tingnan muna ang account bago ulitin; posibleng natapos ang request.')
    try:
        _profile(admin, user_id)
    except SetupError:
        raise SetupError('Nakumpirma ang password update pero hindi ang active profile. I-review ang profile; hindi kailangang mag-delete ng account.') from None
    return {'user_id': user_id, 'username': number, 'email': email}


def launch():
    try:
        import tkinter as tk
        from tkinter import messagebox, ttk
    except ImportError:
        print("Kailangan ang Python 3 na may Tcl/Tk. I-enable ang 'tcl/tk and IDLE' sa Python installer.")
        return 1
    root = tk.Tk()
    AdminAccessWindow(root, tk, ttk, messagebox)
    root.mainloop()
    return 0


class AdminAccessWindow:
    def __init__(self, root, tk, ttk, messagebox):
        self.root, self.tk, self.ttk, self.messagebox = root, tk, ttk, messagebox
        self.messages = queue.Queue()
        self.busy = self.closed = False
        self.admins = []
        self.loaded_context = None
        self.poll_id = None
        root.title('PGENRO IMS | Admin Setup and Recovery v3')
        root.geometry('730x740')
        root.minsize(660, 680)
        root.configure(bg='#edf4ef')
        root.protocol('WM_DELETE_WINDOW', self.close)
        style = ttk.Style(root)
        if 'clam' in style.theme_names():
            style.theme_use('clam')
        style.configure('TFrame', background='#ffffff')
        style.configure('TLabel', background='#ffffff', foreground='#203d30', font=('Segoe UI', 10))
        style.configure('TEntry', padding=7, font=('Segoe UI', 10))
        style.configure('TButton', padding=7, font=('Segoe UI', 10))
        style.configure('TCheckbutton', background='#ffffff', font=('Segoe UI', 10))
        style.configure('Action.TButton', background='#087b57', foreground='#ffffff', padding=10, font=('Segoe UI', 11, 'bold'))
        style.map('Action.TButton', background=[('active', '#086548'), ('disabled', '#a9c5b7')])
        card = ttk.Frame(root, padding=24)
        card.pack(fill='both', expand=True, padx=18, pady=18)
        ttk.Label(card, text='PGENRO  /  ADMIN ACCESS', foreground='#087b57', font=('Segoe UI', 10, 'bold')).pack(anchor='w')
        ttk.Label(card, text='I-recover ang Admin access', font=('Segoe UI', 21, 'bold')).pack(anchor='w', pady=(5, 3))
        ttk.Label(card, text='Piliin ang existing Admin at mag-set ng bagong password.').pack(anchor='w', pady=(0, 13))
        ttk.Label(card, text='Project URL').pack(anchor='w')
        self.url = tk.StringVar(root, value=os.environ.get('SUPABASE_URL') or DEFAULT_URL)
        self.url_entry = ttk.Entry(card, textvariable=self.url)
        self.url_entry.pack(fill='x', pady=(4, 10))
        ttk.Label(card, text='Server secret / service_role key').pack(anchor='w')
        key_row = ttk.Frame(card)
        key_row.pack(fill='x', pady=(4, 5)); key_row.columnconfigure(0, weight=1)
        self.key = tk.StringVar(root)
        self.key_entry = ttk.Entry(key_row, textvariable=self.key, show='*')
        self.key_entry.grid(row=0, column=0, sticky='ew', padx=(0, 7))
        self.paste_button = ttk.Button(key_row, text='I-paste', command=self.paste_key)
        self.paste_button.grid(row=0, column=1)
        ttk.Label(card, text='Kunin sa Supabase > Settings > API Keys.', foreground='#5b6f65').pack(anchor='w', pady=(0, 10))
        self.tabs = ttk.Notebook(card)
        self.tabs.pack(fill='x', pady=(0, 12))
        self.recover_tab = ttk.Frame(self.tabs, padding=12)
        self.create_tab = ttk.Frame(self.tabs, padding=12)
        self.tabs.add(self.recover_tab, text='I-recover ang existing Admin')
        self.tabs.add(self.create_tab, text='Gumawa ng unang Admin')
        ttk.Label(self.recover_tab, text='Existing Admin').pack(anchor='w')
        row = ttk.Frame(self.recover_tab); row.pack(fill='x', pady=(5, 6)); row.columnconfigure(0, weight=1)
        self.admin_choice = ttk.Combobox(row, state='readonly', values=[])
        self.admin_choice.grid(row=0, column=0, sticky='ew', padx=(0, 7))
        self.find_button = ttk.Button(row, text='Hanapin Admin', command=self.find_admins)
        self.find_button.grid(row=0, column=1)
        ttk.Label(self.recover_tab, text='Hanapin muna ang account. Walang account o records na buburahin.', foreground='#5b6f65', wraplength=590).pack(anchor='w')
        ttk.Label(self.create_tab, text='Admin ID').pack(anchor='w')
        self.number = tk.StringVar(root, value=DEFAULT_NUMBER)
        self.number_entry = ttk.Entry(self.create_tab, textvariable=self.number)
        self.number_entry.pack(fill='x', pady=(5, 4))
        self.alias = ttk.Label(self.create_tab, foreground='#5b6f65')
        self.alias.pack(anchor='w')
        self.number.trace_add('write', self.update_alias); self.update_alias()
        passwords = ttk.Frame(card); passwords.pack(fill='x')
        passwords.columnconfigure(0, weight=1, uniform='password'); passwords.columnconfigure(1, weight=1, uniform='password')
        ttk.Label(passwords, text='Bagong password (12-128 characters)').grid(row=0, column=0, sticky='w', pady=(0, 5))
        ttk.Label(passwords, text='Ulitin ang password').grid(row=0, column=1, sticky='w', pady=(0, 5))
        self.password, self.confirmation = tk.StringVar(root), tk.StringVar(root)
        self.password_entry = ttk.Entry(passwords, textvariable=self.password, show='*')
        self.password_entry.grid(row=1, column=0, sticky='ew', padx=(0, 5))
        self.confirmation_entry = ttk.Entry(passwords, textvariable=self.confirmation, show='*')
        self.confirmation_entry.grid(row=1, column=1, sticky='ew', padx=(5, 0))
        self.show_password = tk.BooleanVar(root, value=False)
        self.show_box = ttk.Checkbutton(card, text='Ipakita ang password', variable=self.show_password, command=self.toggle_password)
        self.show_box.pack(anchor='w', pady=(5, 11))
        self.status = ttk.Label(card, text='I-paste ang key, pagkatapos ay pindutin ang Hanapin Admin.', wraplength=630, justify='left')
        self.status.pack(anchor='w', fill='x', pady=(0, 9))
        self.progress = ttk.Progressbar(card, mode='indeterminate')
        self.progress.pack(fill='x', pady=(0, 9))
        self.action_button = ttk.Button(card, text='Palitan password ng selected Admin', style='Action.TButton', command=self.submit)
        self.action_button.pack(fill='x', pady=(0, 10))
        ttk.Label(card, text='Pag nakapasok, gamitin ang User Management para gumawa ng bagong Admin.', wraplength=630, foreground='#5b6f65').pack(anchor='w')
        self.fields = [self.url_entry, self.key_entry, self.paste_button, self.number_entry,
                       self.password_entry, self.confirmation_entry, self.show_box, self.find_button]
        self.url.trace_add('write', self.invalidate_targets)
        self.key.trace_add('write', self.invalidate_targets)
        self.tabs.bind('<<NotebookTabChanged>>', self.mode_changed)
        self.tabs.bind('<Button-1>', lambda event: 'break' if self.busy else None, add=True)
        self.poll_id = root.after(100, self.poll)
        root.after_idle(self.key_entry.focus_set)
        self.mode_changed()

    def update_alias(self, *unused):
        try:
            text = 'Login address: ' + employee_number(self.number.get()).lower() + '@pgenro.ims'
        except SetupError:
            text = 'Halimbawa: A0001 o Admin001'
        self.alias.configure(text=text)

    def recovery_mode(self):
        return self.tabs.select() == str(self.recover_tab)

    def context(self):
        return self.url.get().strip().rstrip('/'), self.key.get().strip()

    def invalidate_targets(self, *unused):
        self.admins = []; self.loaded_context = None
        self.admin_choice.configure(values=[]); self.admin_choice.set('')

    def mode_changed(self, *unused):
        if self.busy and self.tabs.select() != self.job_tab:
            self.tabs.select(self.job_tab)
            return
        self.action_button.configure(text='Palitan password ng selected Admin' if self.recovery_mode() else 'Gumawa ng unang Admin')

    def paste_key(self):
        try:
            self.key.set(self.root.clipboard_get().strip())
        except self.tk.TclError:
            self.messagebox.showinfo('I-paste ang key', 'I-copy muna ang server key mula sa Supabase API Keys.', parent=self.root)

    def toggle_password(self):
        mask = '' if self.show_password.get() else '*'
        self.password_entry.configure(show=mask); self.confirmation_entry.configure(show=mask)

    def set_busy(self, value):
        if value:
            self.job_tab = self.tabs.select()
        self.busy = value
        for field in self.fields:
            field.configure(state='disabled' if value else 'normal')
        self.admin_choice.configure(state='disabled' if value else 'readonly')
        self.action_button.configure(state='disabled' if value else 'normal')
        if value:
            self.progress.start(12)
        else:
            self.progress.stop()

    def start_job(self, job, action):
        if self.busy:
            return
        self.show_password.set(False); self.toggle_password()
        self.set_busy(True)
        def worker():
            try:
                value = action(lambda text: self.messages.put(('progress', text)))
                self.messages.put((job, value))
            except SetupError as error:
                self.messages.put(('error', str(error)))
            except Exception:
                self.messages.put(('error', 'Hindi nakumpirma ang request. I-review muna ang account bago ulitin.'))
        threading.Thread(target=worker, daemon=True).start()

    def find_admins(self):
        if self.busy:
            return
        try:
            context = self.context()
            admin = SupabaseAdmin(*context)
        except SetupError as error:
            self.messagebox.showerror('Suriin ang key / URL', str(error), parent=self.root); return
        self.status.configure(text='Hinahanap ang existing active Admin...', foreground='#203d30')
        self.start_job('admins', lambda report: (context, list_active_admins(admin)))

    def submit(self):
        if self.busy:
            return
        try:
            admin = SupabaseAdmin(*self.context())
            chosen_password = self.password.get()
            if not 12 <= len(chosen_password) <= 128:
                raise SetupError('Pumili ng password na may 12-128 characters.')
            if chosen_password != self.confirmation.get():
                raise SetupError('Hindi magkapareho ang passwords.')
            if self.recovery_mode():
                index = self.admin_choice.current()
                if self.loaded_context != self.context() or index < 0 or index >= len(self.admins):
                    raise SetupError('Pindutin muna ang Hanapin Admin at pumili ng existing Admin.')
                target = dict(self.admins[index])
                text = ('Palitan ang password ng account na ito?\n\n'
                        + str(target.get('username') or '') + '\n' + str(target.get('email') or '')
                        + '\n\nIko-confirm din ang existing Auth account. Mananatili ang ID, role at records.')
                if not self.messagebox.askyesno('Kumpirmahin ang Admin recovery', text, parent=self.root, default='no'):
                    return
                action = lambda report: recover_admin(admin, chosen_password, target['user_id'], report)
                job = 'recovered'
            else:
                number = employee_number(self.number.get())
                action = lambda report: setup(admin, chosen_password, number, report)
                job = 'created'
        except SetupError as error:
            self.messagebox.showerror('Suriin ang form', str(error), parent=self.root); return
        self.status.configure(text='Sinisimulan ang request. Please wait...', foreground='#203d30')
        self.start_job(job, action)

    def poll(self):
        if self.closed:
            return
        try:
            while True:
                kind, value = self.messages.get_nowait()
                if kind == 'progress':
                    self.status.configure(text=value); continue
                self.set_busy(False)
                if kind == 'admins':
                    context, rows = value
                    if context != self.context():
                        self.status.configure(text='Nagbago ang URL o key. Hanapin muli ang Admin.'); continue
                    self.admins, self.loaded_context = rows, context
                    labels = [(str(p.get('username') or '(no username)') + '  |  ' + str(p.get('email') or '')) for p in rows]
                    self.admin_choice.configure(values=labels)
                    if rows:
                        self.admin_choice.current(0)
                        self.status.configure(text='Piliin ang Admin, ilagay ang bagong password, at pindutin ang Palitan password.')
                    else:
                        self.status.configure(text='Walang active Admin. Gamitin ang Gumawa ng unang Admin tab.')
                elif kind in ('recovered', 'created'):
                    number = value['username'] if kind == 'recovered' else value
                    self.key.set(''); self.password.set(''); self.confirmation.set('')
                    text = ('Password updated. ' if kind == 'recovered' else 'Admin created. ') + 'Mag-login gamit ang ' + number + ' at ang password na pinili mo.'
                    self.status.configure(text=text, foreground='#087b57')
                    self.messagebox.showinfo('Admin access ready', text + '\n\nSa IMS User Management puwedeng gumawa ng bagong Admin.', parent=self.root)
                else:
                    self.status.configure(text='Hindi nakumpirma ang request. Basahin ang detalye sa mensahe.', foreground='#a12b2b')
                    self.messagebox.showerror('Setup / recovery status', value, parent=self.root)
        except queue.Empty:
            pass
        self.poll_id = self.root.after(100, self.poll)

    def close(self):
        if self.busy:
            self.messagebox.showinfo('May request pa', 'Hintaying matapos ang request para makita ang resulta.', parent=self.root)
            return
        self.closed = True
        if self.poll_id:
            self.root.after_cancel(self.poll_id)
        self.key.set(''); self.password.set(''); self.confirmation.set('')
        self.loaded_context = None
        self.root.destroy()


if __name__ == '__main__':
    sys.exit(launch())
