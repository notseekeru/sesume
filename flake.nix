{
  description = "resume: one-page LaTeX resume and its layout gate";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
    in
    {
      devShells = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              (pkgs.texliveSmall.withPackages (
                ps: with ps; [
                  latexmk
                  titlesec
                  enumitem
                  charter
                ]
              ))
              pkgs.poppler-utils
            ];
          };
        }
      );
    };
}
