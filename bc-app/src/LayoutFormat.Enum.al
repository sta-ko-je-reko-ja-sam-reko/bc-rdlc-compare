namespace RepLayoutPreview;

enum 74750 "BCLP Layout Format"
{
    Extensible = false;
    Caption = 'Layout Format';

    value(0; RDLC)
    {
        Caption = 'RDLC';
    }
    value(1; Word)
    {
        Caption = 'Word';
    }
    value(2; Excel)
    {
        Caption = 'Excel';
    }
}
