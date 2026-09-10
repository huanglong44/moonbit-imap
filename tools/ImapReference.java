import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetup;
import java.io.BufferedReader;
import java.io.InputStreamReader;

/** Original harness; GreenMail is an external test-only dependency. */
class ImapReference {
    public static void main(String[] args) throws Exception {
        GreenMail server = new GreenMail(new ServerSetup(0, "127.0.0.1", "imap"));
        server.setUser("demo@localhost", "demo", "test-only");
        try {
            server.start();
            System.out.println("READY " + server.getImap().getPort());
            System.out.flush();
            new BufferedReader(new InputStreamReader(System.in)).readLine();
        } finally {
            server.stop();
        }
    }
}
