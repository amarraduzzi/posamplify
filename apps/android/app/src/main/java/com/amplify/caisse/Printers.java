package com.amplify.caisse;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * The ticket printers this tablet can reach. Every ticket printer speaks ESC/POS; we only move the
 * bytes the till prepared:
 *  - network (wifi or cable): port 9100 ("RAW"), found by scanning the local network or typed by IP;
 *  - Bluetooth: printers paired in the Android settings (classic Bluetooth, serial profile), including
 *    the built-in printer of Sunmi tablets ("InnerPrinter");
 *  - USB: printers plugged into the tablet (USB host), the first time Android asks to allow it.
 * Names are stable ("Wifi 192.168.1.50", "Bluetooth PT-210", "USB Printer 0483:5743"): the till keeps
 * which printer prints what by name, like on Windows.
 */
final class Printers {
    static final class Printer {
        final String name, kind, address;
        Printer(String name, String kind, String address) { this.name = name; this.kind = kind; this.address = address; }
    }

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final Pattern PRINTERISH = Pattern.compile("(?i)print|pos|thermal|receipt|ticket|innerprinter|xprinter|xp-|pt-|mtp|rpp|zj|goojprt|bixolon|epson|star|sunmi|imin|hprt|munbyn|netum|rongta|gprinter");
    private static final String USB_PERMISSION = "com.amplify.caisse.USB_PERMISSION";
    private static Context ctx;
    private static SharedPreferences prefs;
    private static final Set<String> found = Collections.synchronizedSet(new LinkedHashSet<>());

    private Printers() { }

    static void init(Context c) {
        ctx = c.getApplicationContext();
        prefs = ctx.getSharedPreferences("printers", Context.MODE_PRIVATE);
        // look for network printers in the background as soon as the till opens
        new Thread(Printers::scanNetwork).start();
    }

    // ------------------------------------------------------------------ list
    static List<Printer> list() {
        List<Printer> out = new ArrayList<>();
        // network: added by hand first, then found by the scan
        Set<String> ips = new LinkedHashSet<>(prefs.getStringSet("network", Collections.emptySet()));
        synchronized (found) { ips.addAll(found); }
        for (String ip : ips) out.add(new Printer(netName(ip), "network", ip));
        out.addAll(bluetooth());
        out.addAll(usb());
        return out;
    }

    static String netName(String ipPort) {
        return "Wifi " + (ipPort.endsWith(":9100") ? ipPort.substring(0, ipPort.length() - 5) : ipPort);
    }

    // ------------------------------------------------------------------ network
    /** Every address of the tablet's own network (/24) on port 9100, in parallel: a few seconds. */
    static void scanNetwork() {
        String base = localBase();
        if (base == null) return;
        ExecutorService ex = Executors.newFixedThreadPool(48);
        Set<String> now = Collections.synchronizedSet(new LinkedHashSet<>());
        for (int i = 1; i < 255; i++) {
            final String ip = base + i;
            ex.execute(() -> {
                try (Socket s = new Socket()) {
                    s.connect(new InetSocketAddress(ip, 9100), 600);
                    now.add(ip + ":9100");
                } catch (Exception ignored) { }
            });
        }
        ex.shutdown();
        try { ex.awaitTermination(8, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        synchronized (found) { found.clear(); found.addAll(now); }
    }

    private static String localBase() {
        try {
            for (Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces(); e.hasMoreElements(); ) {
                NetworkInterface n = e.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                for (Enumeration<InetAddress> a = n.getInetAddresses(); a.hasMoreElements(); ) {
                    InetAddress ad = a.nextElement();
                    if (ad instanceof Inet4Address && ad.isSiteLocalAddress()) {
                        String ip = ad.getHostAddress();
                        return ip.substring(0, ip.lastIndexOf('.') + 1);
                    }
                }
            }
        } catch (Exception ignored) { }
        return null;
    }

    /** Adds a network printer by its IP address (checked first). Returns an error message or null. */
    static String addNetwork(String ip, int port) {
        ip = ip.trim();
        if (!ip.matches("^\\d{1,3}(\\.\\d{1,3}){3}$")) return "Adresse IP invalide (exemple : 192.168.1.50).";
        if (port <= 0 || port > 65535) port = 9100;
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(ip, port), 2500);
        } catch (Exception e) {
            return "Aucune imprimante ne répond sur " + ip + ". Vérifiez qu'elle est allumée et sur le même wifi.";
        }
        Set<String> set = new LinkedHashSet<>(prefs.getStringSet("network", Collections.emptySet()));
        set.add(ip + ":" + port);
        prefs.edit().putStringSet("network", set).apply();
        return null;
    }

    static void forget(String name) {
        Set<String> set = new LinkedHashSet<>(prefs.getStringSet("network", Collections.emptySet()));
        set.removeIf(ip -> netName(ip).equalsIgnoreCase(name));
        prefs.edit().putStringSet("network", set).apply();
        synchronized (found) { found.removeIf(ip -> netName(ip).equalsIgnoreCase(name)); }
    }

    private static String printNetwork(String ipPort, byte[] data) {
        String[] p = ipPort.split(":");
        int port = p.length > 1 ? Integer.parseInt(p[1]) : 9100;
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(p[0], port), 4000);
            s.setSoTimeout(8000);
            OutputStream o = s.getOutputStream();
            o.write(data);
            o.flush();
            Thread.sleep(150); // let the printer take the last bytes before the connection closes
            return null;
        } catch (Exception e) {
            return "Imprimante " + p[0] + " injoignable. Vérifiez qu'elle est allumée et sur le même wifi.";
        }
    }

    // ------------------------------------------------------------------ Bluetooth
    private static boolean btAllowed() {
        return Build.VERSION.SDK_INT < 31 || ctx.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private static BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    @SuppressLint("MissingPermission")
    private static List<Printer> bluetooth() {
        List<Printer> out = new ArrayList<>();
        try {
            BluetoothAdapter a = adapter();
            if (a == null || !btAllowed() || !a.isEnabled()) return out;
            for (BluetoothDevice d : a.getBondedDevices()) {
                String n = d.getName() == null ? d.getAddress() : d.getName();
                BluetoothClass cl = d.getBluetoothClass();
                boolean imaging = cl != null && cl.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING;
                if (!imaging && !PRINTERISH.matcher(n).find()) continue; // headphones, cars, phones: not printers
                String name = n.equalsIgnoreCase("InnerPrinter") ? "Imprimante intégrée" : "Bluetooth " + n;
                out.add(new Printer(name, "bluetooth", d.getAddress()));
            }
        } catch (Exception ignored) { }
        return out;
    }

    @SuppressLint("MissingPermission")
    private static String printBluetooth(String address, byte[] data) {
        BluetoothAdapter a = adapter();
        if (a == null) return "Bluetooth indisponible sur cette tablette.";
        if (!btAllowed()) return "Autorisez Bluetooth pour Amplify Caisse (Paramètres Android > Applications).";
        if (!a.isEnabled()) return "Activez le Bluetooth de la tablette.";
        BluetoothSocket s = null;
        try {
            a.cancelDiscovery();
            BluetoothDevice d = a.getRemoteDevice(address);
            s = d.createRfcommSocketToServiceRecord(SPP);
            try { s.connect(); }
            catch (Exception first) {
                // some cheap printers only accept the "insecure" connection
                try { s.close(); } catch (Exception ignored) { }
                s = d.createInsecureRfcommSocketToServiceRecord(SPP);
                s.connect();
            }
            OutputStream o = s.getOutputStream();
            for (int i = 0; i < data.length; i += 512) { // small pieces: cheap printers have a tiny buffer
                o.write(data, i, Math.min(512, data.length - i));
                o.flush();
                Thread.sleep(20);
            }
            Thread.sleep(300);
            return null;
        } catch (Exception e) {
            return "Imprimante Bluetooth injoignable. Est-elle allumée et associée à la tablette ?";
        } finally {
            try { if (s != null) s.close(); } catch (Exception ignored) { }
        }
    }

    // ------------------------------------------------------------------ USB
    static void refreshUsb() { /* the list is read live; nothing to keep */ }

    private static UsbManager usbManager() { return (UsbManager) ctx.getSystemService(Context.USB_SERVICE); }

    private static UsbInterface printerInterface(UsbDevice d) {
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface f = d.getInterface(i);
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER && bulkOut(f) != null) return f;
        }
        for (int i = 0; i < d.getInterfaceCount(); i++) { // some printers use a vendor class
            UsbInterface f = d.getInterface(i);
            if (bulkOut(f) != null && f.getInterfaceClass() != UsbConstants.USB_CLASS_MASS_STORAGE && f.getInterfaceClass() != UsbConstants.USB_CLASS_HID) return f;
        }
        return null;
    }

    private static UsbEndpoint bulkOut(UsbInterface f) {
        for (int e = 0; e < f.getEndpointCount(); e++) {
            UsbEndpoint ep = f.getEndpoint(e);
            if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) return ep;
        }
        return null;
    }

    private static List<Printer> usb() {
        List<Printer> out = new ArrayList<>();
        try {
            UsbManager m = usbManager();
            if (m == null) return out;
            for (UsbDevice d : m.getDeviceList().values()) {
                if (printerInterface(d) == null) continue;
                String label = d.getProductName() != null ? d.getProductName() : "Printer";
                out.add(new Printer(String.format(Locale.ROOT, "USB %s %04x:%04x", label, d.getVendorId(), d.getProductId()), "usb", d.getDeviceName()));
            }
        } catch (Exception ignored) { }
        return out;
    }

    private static String printUsb(String deviceName, byte[] data) {
        UsbManager m = usbManager();
        UsbDevice d = m == null ? null : m.getDeviceList().get(deviceName);
        if (d == null) return "Imprimante USB débranchée.";
        if (!m.hasPermission(d)) {
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            m.requestPermission(d, PendingIntent.getBroadcast(ctx, 0, new Intent(USB_PERMISSION).setPackage(ctx.getPackageName()), flags));
            return "Autorisez l'imprimante USB dans la fenêtre qui s'affiche, puis réimprimez.";
        }
        UsbInterface f = printerInterface(d);
        UsbEndpoint ep = f == null ? null : bulkOut(f);
        if (ep == null) return "Cet appareil USB n'est pas une imprimante.";
        UsbDeviceConnection c = m.openDevice(d);
        if (c == null) return "Impossible d'ouvrir l'imprimante USB.";
        try {
            c.claimInterface(f, true);
            for (int i = 0; i < data.length; i += 4096) {
                int n = Math.min(4096, data.length - i);
                byte[] part = new byte[n];
                System.arraycopy(data, i, part, 0, n);
                if (c.bulkTransfer(ep, part, n, 5000) < 0) return "L'imprimante USB ne répond pas.";
            }
            return null;
        } finally {
            try { c.releaseInterface(f); } catch (Exception ignored) { }
            c.close();
        }
    }

    // ------------------------------------------------------------------ print
    /** Prints raw ESC/POS bytes on the printer with this name. Returns an error message or null. */
    static synchronized String print(String name, byte[] data) {
        List<Printer> all = list();
        Printer p = null;
        for (Printer x : all) if (x.name.equalsIgnoreCase(name)) { p = x; break; }
        // a name from the Windows till ("TICKET"...) or none chosen yet: the only printer there is
        if (p == null && all.size() == 1) p = all.get(0);
        if (p == null) return all.isEmpty()
            ? "Aucune imprimante trouvée. Allumez-la, mettez-la sur le même wifi (ou associez-la en Bluetooth), puis touchez Rechercher."
            : "Imprimante « " + name + " » introuvable : choisissez-la dans Réglages du poste.";
        switch (p.kind) {
            case "network": return printNetwork(p.address, data);
            case "bluetooth": return printBluetooth(p.address, data);
            case "usb": return printUsb(p.address, data);
            default: return "Type d'imprimante inconnu.";
        }
    }
}
