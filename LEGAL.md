# Legal notes

[Deutsch](RECHTLICHES.md)

As of 28 October 2026 (version 1.0.0). This is a careful assessment, not legal advice. The German version is
authoritative.

## Copyright in the project's own code

The code in this repository was written independently. It contains no code from the manufacturer
software (no APK, no decompiled classes, no manufacturer libraries).

## Interoperability and reverse engineering

Knowledge about the data bus and the serial protocol was obtained by analysing the software
installed on the author's own device, solely to develop an independently created, interoperable
program.

- **Switzerland:** Art. 21 of the Copyright Act (URG) allows lawful users to obtain the interface
  information needed for interoperability by decompiling program code and to use it for developing,
  maintaining and using interoperable programs.
- **EU:** Art. 6 of Directive 2009/24/EC (computer programs) treats decompilation for
  interoperability in a similar way.
- **USA:** 17 U.S.C. § 1201(f) contains an exemption for reverse engineering for interoperability.

Only interface information needed for interoperability (command numbers, frame layout, checksum)
and the project's own code are published. Functional facts such as a CRC polynomial are not
protected works.

Not part of the repository and not to be published: manufacturer APKs, decompiled code, backups of
system partitions, firmware.

## Manufacturer terms

The terms of use of the console software may prohibit modifications to the device. This concerns
the person installing the software on their device, not the publication of the project's own
code. Modifications may affect warranty and manufacturer updates.

## Trademarks

"Horizon", "Tread-XP", "Johnson Health Tech" and other product names mentioned (e.g. YouTube,
Jellyfin, Zwift, Kinomap, Audiobookshelf) are trademarks of their owners. They are used
descriptively only, to state compatibility. The project and its interface are called "Tread Control";
it is not affiliated with or endorsed by the manufacturer. No logos are used in the project. App icons are read at
runtime from the apps installed on the device and are not part of the repository.

## Maps and routes

- **swisstopo** (SWISSIMAGE aerial imagery, swissALTI3D terrain model): federal geodata has been
  free to use since 1 March 2021 (open government data), with the credit "© swisstopo", which the
  interface displays.
- **OpenStreetMap:** the paths of the sample routes come from OpenStreetMap (© OpenStreetMap
  contributors, ODbL 1.0), matched with BRouter. Attribution is required for these produced works
  and is included in every route file.
- **Race organisers' routes** (GPX from organisers, Outdooractive, Strava) are not included because
  redistribution is not permitted.

## Images

Background images of the interface were created with an image generator (Google Gemini).
Screenshots of third-party apps are not included.

## Liability

The software is provided free of charge and without warranty (see LICENSE). Under Swiss law a
donor is liable only for intent and gross negligence (Art. 248 Code of Obligations); a complete
exclusion is not possible. Hence: no warranted properties, explicit safety notes
([SAFETY.md](SAFETY.md)), documented tests.

## Privacy

The repository contains no personal data. Run data stays on the console; the app sends nothing to
third parties. Network access happens only when importing a route (elevation and map tiles) and
inside the media apps themselves.
