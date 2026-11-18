# shellcheck shell=sh
# Installed as /etc/profile.d/krohn.sh. Debian's /etc/profile resets PATH for
# every login shell (`bash -l`, `docker exec <c> bash -l`, ssh, the terminal
# tool's background `bash -lic`), dropping the image's ENV PATH dirs, so bare
# `krohn` exits 127 there. Put them back in the ENV PATH order; dirs a login
# PATH already lists keep their position.
for __krohn_p in /opt/data/.local/bin /opt/krohn/.venv/bin /opt/krohn/bin; do
    case ":$PATH:" in
        *":$__krohn_p:"*) ;;
        *) PATH="$__krohn_p:$PATH" ;;
    esac
done
unset __krohn_p
export PATH
