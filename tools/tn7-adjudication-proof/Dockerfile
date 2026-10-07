FROM postgis/postgis:16-3.4
WORKDIR /proof
COPY db/005_operator_audit.sql /proof/005_operator_audit.sql
COPY db/006_data_issue_rejected_status.sql /proof/006_data_issue_rejected_status.sql
COPY db/007_two_person_decision_proposals.sql /proof/007_two_person_decision_proposals.sql
COPY db/008_transport_entity_aliases.sql /proof/008_transport_entity_aliases.sql
COPY db/009_rank_association_promotions.sql /proof/009_rank_association_promotions.sql
COPY db/010_route_candidate_promotions.sql /proof/010_route_candidate_promotions.sql
COPY tools/tn7-adjudication-proof/setup.sh /proof/setup.sh
RUN chmod +x /proof/setup.sh
CMD ["/proof/setup.sh"]
