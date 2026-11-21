// Reads one socket descriptor with the public libproc structures, so their layout comes from the
// system headers instead of a copy in Rust.
#include <arpa/inet.h>
#include <errno.h>
#include <libproc.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/socket.h>

// Returns 1 for a listening TCP socket, 0 for any other descriptor, or -1 with errno. The family
// is AF_INET or AF_INET6.
int odt_tcp_listener(int pid, int fd, int *family, unsigned char address[16], int *port) {
  struct socket_fdinfo info;
  memset(&info, 0, sizeof(info));
  // A failed call can leave errno unchanged, so a value from an earlier call must not count.
  errno = 0;
  int size = proc_pidfdinfo(pid, fd, PROC_PIDFDSOCKETINFO, &info, sizeof(info));
  if (size <= 0) return errno == EBADF ? 0 : -1;
  if (size < (int)sizeof(info)) return 0;
  if (info.psi.soi_kind != SOCKINFO_TCP) return 0;
  struct tcp_sockinfo *tcp = &info.psi.soi_proto.pri_tcp;
  if (tcp->tcpsi_state != TSI_S_LISTEN) return 0;
  struct in_sockinfo *in = &tcp->tcpsi_ini;
  *port = ntohs((unsigned short)in->insi_lport);
  memset(address, 0, 16);
  if (info.psi.soi_family == AF_INET || (in->insi_vflag & INI_IPV6) == 0) {
    *family = AF_INET;
    memcpy(address, &in->insi_laddr.ina_46.i46a_addr4, 4);
  } else {
    *family = AF_INET6;
    memcpy(address, &in->insi_laddr.ina_6, 16);
  }
  return 1;
}
