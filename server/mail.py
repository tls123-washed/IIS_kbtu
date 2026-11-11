import argparse
import smtplib
import ssl
from email.message import EmailMessage
from email.policy import SMTP
from uuid import uuid4

from .config import ROOT, settings
from .mail_graph import GraphMailError, authorize, send_graph


class MailDeliveryError(Exception):
    pass


def send_code(email: str, code: str):
    subject = "Код регистрации Campus Threads"
    text = (f"Ваш код: {code}\nКод действует 10 минут.\n"
            "Если вы не запрашивали код, письмо можно проигнорировать.")
    config = settings()
    try:
        if config.graph:
            send_graph(config.graph, config.secret, email, subject, text)
        else:
            send_email(config, email, subject, text)
    except GraphMailError as error:
        raise MailDeliveryError(str(error)) from None
    except smtplib.SMTPResponseException as error:
        raise MailDeliveryError(f"SMTP отклонил отправку (код {error.smtp_code}).") from None
    except (OSError, smtplib.SMTPException):
        raise MailDeliveryError("Сбой соединения или записи почтового файла.") from None


def send_email(config, email, subject, text):
    message = EmailMessage(policy=SMTP)
    message["From"] = config.smtp_from or "campus-threads@localhost"
    message["To"] = email
    message["Subject"] = subject
    message.set_content(text)
    if config.mail_mode == "file":
        mailbox = ROOT / ".mailbox"
        mailbox.mkdir(exist_ok=True)
        (mailbox / f"{uuid4()}.eml").write_bytes(message.as_bytes())
        return

    context = ssl.create_default_context()
    if config.smtp_security == "ssl":
        client = smtplib.SMTP_SSL(config.smtp_host, config.smtp_port, timeout=10, context=context)
    else:
        client = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=10)
    with client:
        if config.smtp_security == "starttls":
            client.starttls(context=context)
        if config.smtp_user:
            client.login(config.smtp_user, config.smtp_password)
        client.send_message(message)


def main():
    parser = argparse.ArgumentParser(description="Подключение корпоративной почты через Microsoft Graph")
    parser.add_argument("command", choices=["authorize", "test"])
    command = parser.parse_args().command
    try:
        config = settings()
    except RuntimeError as error:
        parser.error(str(error))
    if not config.graph:
        parser.error("Установите MAIL_MODE=graph и заполните GRAPH_* в .env.")
    try:
        if command == "authorize":
            authorize(config.graph, config.secret)
            print("Почта подключена. Можно запустить сервер или проверить отправку командой test.")
        else:
            send_graph(config.graph, config.secret, config.graph.sender, "Проверка Campus Threads",
                       "Это проверка отправки Campus Threads через корпоративную почту KBTU.")
            print("Microsoft Graph принял письмо. Проверьте входящие в Outlook.")
    except GraphMailError as error:
        raise SystemExit(str(error)) from None
    except OSError:
        raise SystemExit("Не удалось подключиться к Microsoft или сохранить почтовые настройки.") from None


if __name__ == "__main__":
    main()
