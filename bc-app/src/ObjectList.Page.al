namespace RepLayoutPreview;

using System.Reflection;

page 74752 "BCLP Object List API"
{
    PageType = API;
    Caption = 'Object';
    APIPublisher = 'RepLayoutPreview';
    APIGroup = 'layoutPreview';
    APIVersion = 'v1.0';
    EntityName = 'bcObject';
    EntitySetName = 'bcObjects';
    SourceTable = AllObjWithCaption;
    ODataKeyFields = SystemId;
    Extensible = false;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                }
                field(objectType; Rec."Object Type")
                {
                    Caption = 'Object Type';
                }
                field(objectId; Rec."Object ID")
                {
                    Caption = 'Object Id';
                }
                field(objectName; Rec."Object Name")
                {
                    Caption = 'Object Name';
                }
                field(objectCaption; Rec."Object Caption")
                {
                    Caption = 'Object Caption';
                }
            }
        }
    }
}
