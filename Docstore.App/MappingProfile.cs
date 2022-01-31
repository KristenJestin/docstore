using AutoMapper;
using Docstore.App.Models.Forms;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;

namespace Docstore.App
{
    public class MappingProfile : Profile
    {
        public MappingProfile()
        {
            CreateMap<DocumentForm, Document>()
                .ForMember(x => x.Files, act => act.Ignore())
                .ForMember(x => x.Tags, act => act.Ignore())
                .ReverseMap()
                .ForMember(x => x.Files, act => act.Ignore())
                .ForMember(x => x.Tags, act => act.Ignore());

            CreateMap<FolderCreateForm, Folder>();

            CreateMap<Folder, GetFolderDto>();

            CreateMap<DocumentFile, GetDocumentFileDto>();
        }
    }
}
