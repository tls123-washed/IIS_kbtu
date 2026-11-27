from base64 import b64decode
from binascii import Error as Base64Error
from io import BytesIO

from fastapi import HTTPException
from PIL import Image


def prepare_photo(value: str, error_message: str) -> bytes:
    try:
        raw = b64decode(value, validate=True)
        with Image.open(BytesIO(raw), formats=['JPEG']) as image:
            if max(image.size) > 960:
                raise ValueError
            output = BytesIO()
            image.convert('RGB').save(output, format='JPEG', quality=78, optimize=True)
        if output.tell() > 200_000:
            raise ValueError
        return output.getvalue()
    except (Base64Error, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, error_message) from None
