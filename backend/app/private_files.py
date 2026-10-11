"""Protect an already-open secret file on POSIX and Windows NTFS."""

import os


def protect_private_fd(fd: int) -> None:
    if os.name != "nt":
        os.fchmod(fd, 0o600)
        return
    # chmod on Windows only changes the read-only bit. Set a protected DACL
    # for the file's owner and SYSTEM, using the open handle rather than a path.
    import ctypes
    import msvcrt
    from ctypes import wintypes

    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    pointer = ctypes.c_void_p
    advapi.GetSecurityInfo.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.DWORD,
        pointer,
        pointer,
        pointer,
        pointer,
        pointer,
    ]
    advapi.GetSecurityInfo.restype = wintypes.DWORD
    advapi.ConvertSidToStringSidW.argtypes = [pointer, pointer]
    advapi.ConvertSidToStringSidW.restype = wintypes.BOOL
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        pointer,
        pointer,
    ]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    advapi.GetSecurityDescriptorDacl.argtypes = [pointer, pointer, pointer, pointer]
    advapi.GetSecurityDescriptorDacl.restype = wintypes.BOOL
    advapi.SetSecurityInfo.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.DWORD,
        pointer,
        pointer,
        pointer,
        pointer,
    ]
    advapi.SetSecurityInfo.restype = wintypes.DWORD
    kernel.LocalFree.argtypes = [pointer]
    kernel.LocalFree.restype = pointer
    kernel.ReOpenFile.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD]
    kernel.ReOpenFile.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    # CRT handles may not include WRITE_DAC. Reopen the same object with
    # security access; never resolve its name and risk a replacement race.
    reopened = kernel.ReOpenFile(wintypes.HANDLE(msvcrt.get_osfhandle(fd)), 0x00060000, 7, 0)
    if reopened == wintypes.HANDLE(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    handle = wintypes.HANDLE(reopened)
    owner, original, sid_string, descriptor, acl = (pointer() for _ in range(5))
    try:
        result = advapi.GetSecurityInfo(
            handle, 1, 1, ctypes.byref(owner), None, None, None, ctypes.byref(original)
        )
        if result:
            raise ctypes.WinError(result)
        if not advapi.ConvertSidToStringSidW(owner, ctypes.byref(sid_string)):
            raise ctypes.WinError(ctypes.get_last_error())
        sid = ctypes.wstring_at(sid_string)
        sddl = f"D:P(A;;FA;;;{sid})(A;;FA;;;SY)"
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl, 1, ctypes.byref(descriptor), None
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        present, defaulted = wintypes.BOOL(), wintypes.BOOL()
        if (
            not advapi.GetSecurityDescriptorDacl(
                descriptor, ctypes.byref(present), ctypes.byref(acl), ctypes.byref(defaulted)
            )
            or not present
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        result = advapi.SetSecurityInfo(handle, 1, 0x80000004, None, None, acl, None)
        if result:
            raise ctypes.WinError(result)
    finally:
        for allocation in (descriptor, sid_string, original):
            if allocation.value:
                kernel.LocalFree(allocation)
        kernel.CloseHandle(handle)
